import { KubectlV33Layer } from '@aws-cdk/lambda-layer-kubectl-v33';
import type { InstanceType } from 'aws-cdk-lib/aws-ec2';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import type { IVpc } from 'aws-cdk-lib/aws-ec2';
import type { KubernetesVersion, Nodegroup } from 'aws-cdk-lib/aws-eks';
import { Addon, CapacityType, Cluster, EndpointAccess } from 'aws-cdk-lib/aws-eks';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Props for {@link KubernetesCluster}.
 */
export interface KubernetesClusterProps {
  /** Name of the EKS cluster. */
  readonly clusterName: string;

  /** VPC to run in. The cluster's nodes are placed in private subnets. */
  readonly vpc: IVpc;

  /**
   * Kubernetes version. Pin it explicitly: an implicit upgrade through a CDK
   * bump is not something you want happening on a `cdk deploy`.
   */
  readonly version: KubernetesVersion;

  /**
   * Node capacity for the default node group.
   */
  readonly capacity: {
    readonly instanceTypes: InstanceType[];
    readonly minSize: number;
    readonly maxSize: number;
    readonly desiredSize: number;
  };
}

/**
 * An EKS cluster with a managed node group, sized from explicit inputs.
 *
 * Two deliberate choices:
 *
 * - `defaultCapacity: 0`. The CDK's built-in capacity creates a node group
 *   with defaults that are hard to reason about and impossible to tune. Node
 *   capacity is declared here instead, so `minSize`/`maxSize` are visible in
 *   the same place as everything else.
 * - The control plane endpoint is public *and* private. Private-only is the
 *   stronger posture, but it makes the cluster unreachable from a laptop
 *   without a bastion or VPN, which is a decision for whoever runs it, not a
 *   default to bake into the construct.
 */
export class KubernetesCluster extends Construct {
  /** The cluster. Use it to attach add-ons and manifests. */
  public readonly cluster: Cluster;

  /** The managed node group that runs the default workloads. */
  public readonly nodeGroup: Nodegroup;

  /** IAM role the nodes assume. */
  public readonly nodeRole: IRole;

  /**
   * AWS-managed add-ons installed on the cluster.
   *
   * Only managed add-ons are here. Anything that needs its own IAM role (the
   * load balancer controller, external-dns, the cluster autoscaler) is an IRSA
   * plus a Helm chart, and belongs in its own construct where the trust policy
   * is visible rather than buried in a list.
   */
  public readonly addons: Addon[];

  constructor(scope: Construct, id: string, props: KubernetesClusterProps) {
    super(scope, id);

    this.nodeRole = new Role(this, 'NodeRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
      ],
    });

    this.cluster = new Cluster(this, 'Cluster', {
      clusterName: props.clusterName,
      version: props.version,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }],
      endpointAccess: EndpointAccess.PUBLIC_AND_PRIVATE,
      // Required since aws-cdk-lib 2.2xx. Must match the cluster version: a
      // kubectl layer older than the API server cannot apply manifests that
      // use newer fields.
      kubectlLayer: new KubectlV33Layer(this, 'KubectlLayer'),
      // Node capacity is declared explicitly below, never implied.
      defaultCapacity: 0,
    });

    this.nodeGroup = this.cluster.addNodegroupCapacity('Default', {
      nodegroupName: `${props.clusterName}-default`,
      instanceTypes: props.capacity.instanceTypes,
      minSize: props.capacity.minSize,
      maxSize: props.capacity.maxSize,
      desiredSize: props.capacity.desiredSize,
      capacityType: CapacityType.ON_DEMAND,
      nodeRole: this.nodeRole,
      subnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
    });

    // metrics-server is what makes `kubectl top` and any horizontal pod
    // autoscaler work. It is an AWS-managed add-on, so it gets patched with the
    // cluster rather than by whoever last ran a helm upgrade.
    this.addons = [
      new Addon(this, 'MetricsServer', {
        cluster: this.cluster,
        addonName: 'metrics-server',
        // Left unpinned on purpose: AWS resolves the default version that
        // matches the cluster's Kubernetes version, and pinning it here would
        // mean editing this file every time that moves. Override it explicitly
        // per environment when you need a reproducible version.
      }),
    ];
  }
}
