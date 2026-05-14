import { IpAddresses, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Props for {@link Network}.
 */
export interface NetworkProps {
  /** Environment name, used for resource naming (`dev`, `prod`). */
  readonly environment: string;

  /**
   * Availability zones to spread subnets across, named explicitly.
   *
   * Passed as literal zone names instead of `maxAzs` on purpose: `maxAzs` makes
   * the CDK call `DescribeAvailabilityZones` at synth time, which means the app
   * cannot be synthesized without AWS credentials and the account id ends up
   * written into `cdk.context.json`. Naming the zones keeps `cdk synth`
   * hermetic, and pins placement so a new AZ in the region does not silently
   * move subnets on the next deploy.
   *
   * Two zones is enough for a single node group; three is what you want if the
   * workload has a hard AZ-failure requirement.
   *
   * @default ['us-east-1a', 'us-east-1b']
   */
  readonly availabilityZones?: string[];

  /**
   * Number of NAT gateways. Each one is roughly USD 32/month plus data
   * processing, so dev deliberately runs a single shared NAT and production
   * runs one per AZ so a single AZ failure does not black-hole egress.
   *
   * @default 1
   */
  readonly natGateways?: number;
}

/**
 * The VPC the cluster runs in.
 *
 * The CIDR is carved out of a /16 rather than left to the CDK default /16
 * range, so the same code can be deployed next to an existing network without
 * a collision. Private subnets get egress; the cluster's nodes never need a
 * public IP.
 */
export class Network extends Construct {
  public readonly vpc: Vpc;

  /** The zones this VPC actually spans. */
  public readonly availabilityZones: string[];

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);

    this.availabilityZones = props.availabilityZones ?? ['us-east-1a', 'us-east-1b'];

    this.vpc = new Vpc(this, 'Vpc', {
      vpcName: `eks-platform-${props.environment}`,
      ipAddresses: IpAddresses.cidr('10.42.0.0/16'),
      availabilityZones: this.availabilityZones,
      natGateways: props.natGateways ?? 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 20,
        },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
      ],
    });
  }
}
