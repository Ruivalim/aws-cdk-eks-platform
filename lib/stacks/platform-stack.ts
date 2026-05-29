import { InstanceType } from 'aws-cdk-lib/aws-ec2';
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks';
import type { StackProps } from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { KubernetesCluster } from '../constructs/kubernetes-cluster';
import { Network } from '../constructs/network';

export interface PlatformStackProps extends StackProps {
  /** Environment name, used for resource naming (`dev`, `prod`). */
  readonly environment: string;
}

/**
 * The cluster platform: network, cluster and node capacity.
 *
 * Networking lives in the same stack as the cluster on purpose. A VPC that is
 * only ever consumed by one cluster is not worth the cross-stack coupling, and
 * splitting it early is what makes `cdk destroy` leave orphaned NAT gateways
 * behind.
 */
export class PlatformStack extends Stack {
  public readonly network: Network;

  public readonly kubernetes: KubernetesCluster;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    const isProduction = props.environment === 'prod';

    // Derived from the stack's region so the zone names always match it. A
    // hardcoded `us-east-1a` in a stack deployed to `sa-east-1` fails at synth
    // with a subset error.
    const region = props.env?.region ?? 'us-east-1';
    const zonesFor = (count: number): string[] =>
      ['a', 'b', 'c'].slice(0, count).map((suffix) => `${region}${suffix}`);

    this.network = new Network(this, 'Network', {
      environment: props.environment,
      // Named explicitly instead of `maxAzs`, which would make the CDK call
      // DescribeAvailabilityZones at synth time and require credentials.
      availabilityZones: zonesFor(isProduction ? 3 : 2),
      // One NAT in dev (cheap), one per AZ in production (survives an AZ loss).
      natGateways: isProduction ? 3 : 1,
    });

    this.kubernetes = new KubernetesCluster(this, 'Kubernetes', {
      clusterName: `eks-platform-${props.environment}`,
      vpc: this.network.vpc,
      // Pinned, not inferred from the CDK version.
      version: KubernetesVersion.V1_33,
      capacity: {
        instanceTypes: [new InstanceType('t3.medium')],
        // Dev runs no idle capacity beyond the minimum; production keeps one
        // spare node so a rollout does not have to wait on a scale-up.
        minSize: isProduction ? 2 : 1,
        maxSize: isProduction ? 6 : 2,
        desiredSize: isProduction ? 3 : 1,
      },
    });
  }
}
