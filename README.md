# aws-cdk-eks-platform

An EKS platform on AWS, defined in TypeScript with the AWS CDK: network,
cluster, node capacity and add-ons.

The point of this repository is not `new eks.Cluster(...)`. It is the decisions
around it that are usually left implicit: which availability zones the subnets
land in, how many NAT gateways you are actually paying for, what the node group
scales between and who can change it, and why `cdk synth` works with no AWS
credentials.

> **This one costs real money.** Unlike the serverless projects in the same
> portfolio, an EKS control plane bills by the hour whether or not anything runs
> on it. See [Cost](#cost) before deploying.

<!-- The badge renders once the repository is public. -->

[![CI](https://github.com/Ruivalim/aws-cdk-eks-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruivalim/aws-cdk-eks-platform/actions/workflows/ci.yml)

## Architecture

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  VPC  10.42.0.0/16                                                     │
  │                                                                        │
  │   public subnets                    private subnets                    │
  │   ┌──────────────┐                  ┌──────────────────────────────┐   │
  │   │  Internet GW │                  │  managed node group          │   │
  │   └──────┬───────┘                  │  t3.medium · min 1 · max 2   │   │
  │          │                          │  (prod: min 2 · max 6)       │   │
  │   ┌──────▼───────┐                  │                              │   │
  │   │  NAT gateway │◀───── egress ────│  nodes have no public IP     │   │
  │   │  one per AZ  │                  └───────────────┬──────────────┘   │
  │   └──────────────┘                                  │                  │
  │                                                     │                  │
  │                                     ┌───────────────▼──────────────┐   │
  │                                     │  EKS control plane           │   │
  │                                     │  k8s 1.33 · public + private │   │
  │                                     │  endpoint                    │   │
  │                                     ├──────────────────────────────┤   │
  │                                     │  metrics-server (managed    │   │
  │                                     │  add-on)                     │   │
  │                                     └──────────────────────────────┘   │
  └────────────────────────────────────────────────────────────────────────┘
```

One stack. Networking lives next to the cluster on purpose: a VPC that is only
ever consumed by one cluster is not worth the cross-stack coupling, and
splitting it early is how `cdk destroy` ends up leaving orphaned NAT gateways
behind.

| Environment | AZs | NAT gateways   | Nodes                |
| ----------- | --- | -------------- | -------------------- |
| `dev`       | 2   | 1 (shared)     | 1 x t3.medium, max 2 |
| `prod`      | 3   | 3 (one per AZ) | 3 x t3.medium, max 6 |

## Running it

Requires Node 24 (see `.nvmrc`) and no AWS account to build or test.

```bash
npm ci
npm run check        # formatting, lint, compile, 11 tests
npx cdk synth -c environment=dev
```

`cdk synth` works with no credentials, and that is a deliberate property, not a
convenience. See [Why synth needs no credentials](#why-synth-needs-no-credentials).

### Deploying

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1

export CDK_TARGET_ACCOUNT=<ACCOUNT_ID>
export CDK_TARGET_REGION=us-east-1
npx cdk deploy -c environment=dev

# And when you are done, because this bills hourly:
npx cdk destroy -c environment=dev
```

Deploy takes around 15 minutes, most of it the control plane. `cdk destroy` is
not instant either: the node group has to drain first.

## Layout

```
bin/app.ts                       entry point: environments, stacks, tags
lib/constructs/
  network.ts                       VPC, subnets, NAT gateways
  kubernetes-cluster.ts            cluster, node group, managed add-ons
lib/stacks/
  platform-stack.ts                sizes everything per environment
test/                            template assertions and placement invariants
```

## Design decisions

**Availability zones are named explicitly.** `maxAzs` makes the CDK call
`DescribeAvailabilityZones` at synth time, which needs credentials, breaks
`cdk synth` in CI, and writes the caller's account id into `cdk.context.json`.
Naming the zones keeps synth hermetic and pins placement, so a new AZ in the
region does not silently move subnets on the next deploy.

**`defaultCapacity: 0`, always.** The CDK's built-in capacity creates a node
group with defaults that are hard to find and harder to tune. Node capacity is
declared explicitly instead, so `minSize`, `maxSize` and `desiredSize` are
visible in the same place as everything else, and a test fails if a second node
group ever appears.

**NAT gateways scale with the environment, and the count is the cost decision.**
One shared NAT in dev; one per AZ in production so a single AZ failure does not
black-hole egress. Each gateway is roughly USD 32/month before data processing,
so this is the line to look at first when the bill is wrong.

**Private subnets only for nodes.** No public IP on any worker. Egress goes
through NAT, ingress goes through the load balancer you put in front.

**The control plane endpoint is public _and_ private.** Private-only is the
stronger posture, but it makes the cluster unreachable from a laptop without a
bastion or a VPN. That is a decision for whoever runs the cluster, not a default
to bake into a construct.

**Only AWS-managed add-ons live in the construct.** `metrics-server` gets
patched with the cluster rather than by whoever last ran a `helm upgrade`.
Anything needing its own IAM role (the load balancer controller, external-dns,
the cluster autoscaler) is an IRSA plus a Helm chart, and belongs in its own
construct where the trust policy is visible rather than buried in a list.

**The Kubernetes version is pinned.** An implicit upgrade through a CDK bump is
not something you want happening on a `cdk deploy`.

**Node capacity is above the minimum in production.** `minSize: 2` with
`desiredSize: 3` keeps a spare node so a rolling deploy does not have to wait on
a scale-up.

### Why synth needs no credentials

An EKS stack is the easiest kind of CDK project to accidentally make
account-dependent. Two rules keep this one independent:

1. **No `Vpc.fromLookup`.** The VPC is created here, not imported, and its zones
   come from a list rather than a live lookup.
2. **No `maxAzs`.** Same reason, one layer down.

Get either wrong and `cdk synth` starts requiring credentials, which means every
pull request needs account access to type-check, and `cdk.context.json` starts
carrying the account id of whoever ran it last.

The account is opt-in through `CDK_TARGET_ACCOUNT`/`CDK_TARGET_REGION` rather
than read from `CDK_DEFAULT_ACCOUNT`, which the CDK CLI fills in from whatever
profile happens to be active on the machine.

## Cost

The numbers that matter, in USD per month, before any workload:

| Line                                   | dev      | prod     |
| -------------------------------------- | -------- | -------- |
| EKS control plane ($0.10/hour)         | ~73      | ~73      |
| NAT gateways (~$32 each)               | ~32      | ~96      |
| Nodes, t3.medium on-demand (~$30 each) | ~30      | ~90      |
| EBS volumes, 20 GB per node            | ~2       | ~6       |
| **Total**                              | **~137** | **~265** |

Two caveats worth stating: prices vary by region and São Paulo is more
expensive than northern Virginia, and the node estimate is the on-demand floor.
Spot capacity, Graviton instance types and a single NAT with a smaller node
group are the three levers that move this most.

This is why the deploy-and-destroy pattern is the sane one for a cluster you are
using to demonstrate something rather than to run something.

## Known limitations

These are real and worth naming rather than hiding:

- **No IRSA.** The node role carries the AWS permissions, so every pod on a
  node inherits them. The load balancer controller and external-dns both need a
  service-account role before this is fit for real workloads.
- **No add-ons beyond metrics-server.** No ingress controller, no cert-manager,
  no autoscaler, no logging pipeline. Those are the next constructs.
- **No multi-account story.** `dev` and `prod` are both configured to deploy
  wherever you point them; there is no account separation, no CDK Pipelines, no
  approval gate.
- **Secrets and manifests are out of scope.** The cluster is provisioned, not
  populated. Workload delivery (ArgoCD, Flux) is a separate concern.

## License

MIT
