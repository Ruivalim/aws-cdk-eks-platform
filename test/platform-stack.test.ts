import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PlatformStack } from '../lib/stacks/platform-stack';

/**
 * Builds a PlatformStack in isolation. Tests never synth the real app: that
 * would couple them to every stack in `bin/app.ts` and make the failure output
 * useless.
 */
function synth(environment: 'dev' | 'prod' = 'dev'): Template {
  const app = new App();
  const stack = new PlatformStack(app, `test-platform-${environment}`, {
    environment,
    env: { account: '111111111111', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

/**
 * The CDK does not emit `AWS::EKS::Cluster`. It emits a custom resource backed
 * by an internal Step Functions state machine, because creating the cluster
 * through CloudFormation directly deadlocks on the role the provider needs to
 * assume. The cluster settings live as JSON under `Properties.Config`.
 */
interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

/**
 * `Template.toJSON()` types `Resources` as `any`, which would leak unsafe
 * access into every assertion. Narrowing it once here keeps the tests typed.
 */
function resources(template: Template): CfnResource[] {
  const map = template.toJSON().Resources as Record<string, CfnResource>;
  return Object.values(map);
}

function resourcesOfType(template: Template, type: string): CfnResource[] {
  return resources(template).filter((resource) => resource.Type === type);
}

/**
 * The CDK does not emit `AWS::EKS::Cluster`. It emits a custom resource backed
 * by an internal Step Functions state machine, because creating the cluster
 * through CloudFormation directly deadlocks on the role the provider needs to
 * assume. The cluster settings live as JSON under `Properties.Config`.
 */
interface ClusterConfig {
  name: string;
  version: string;
  resourcesVpcConfig: {
    subnetIds: Array<{ Ref?: string }>;
    endpointPublicAccess: boolean;
    endpointPrivateAccess: boolean;
  };
}

function clusterConfig(template: Template): ClusterConfig {
  const resource = resources(template).find((r) => r.Type === 'Custom::AWSCDK-EKS-Cluster') as
    { Properties: { Config: ClusterConfig } } | undefined;

  if (!resource) {
    throw new Error('Template has no Custom::AWSCDK-EKS-Cluster resource.');
  }

  return resource.Properties.Config;
}

describe('PlatformStack', () => {
  test('creates one EKS cluster with a pinned version', () => {
    const config = clusterConfig(synth());

    expect(config.name).toBe('eks-platform-dev');
    expect(config.version).toBe('1.33');
  });

  test('exposes the control plane on both public and private endpoints', () => {
    const { resourcesVpcConfig } = clusterConfig(synth());

    expect(resourcesVpcConfig.endpointPublicAccess).toBe(true);
    expect(resourcesVpcConfig.endpointPrivateAccess).toBe(true);
  });

  test('places the cluster in private subnets only', () => {
    const { resourcesVpcConfig } = clusterConfig(synth());

    expect(resourcesVpcConfig.subnetIds.length).toBeGreaterThan(0);

    const nonPrivate = resourcesVpcConfig.subnetIds.filter(
      (s) => !s.Ref?.includes('privateSubnet'),
    );

    expect(nonPrivate).toEqual([]);
  });

  test('creates exactly one node group, never the CDK default capacity', () => {
    // defaultCapacity: 0 is the whole point of the construct. A second node
    // group here would mean capacity crept back in implicitly.
    synth().resourceCountIs('AWS::EKS::Nodegroup', 1);
  });

  test('sizes dev capacity to the minimum it needs', () => {
    synth().hasResourceProperties('AWS::EKS::Nodegroup', {
      ScalingConfig: { MinSize: 1, DesiredSize: 1, MaxSize: 2 },
    });
  });

  test('sizes production capacity above dev', () => {
    synth('prod').hasResourceProperties('AWS::EKS::Nodegroup', {
      ScalingConfig: { MinSize: 2, DesiredSize: 3, MaxSize: 6 },
    });
  });

  test('spreads subnets across the configured number of AZs', () => {
    expect(synth('dev').resourceCountIs('AWS::EC2::Subnet', 4));
    expect(synth('prod').resourceCountIs('AWS::EC2::Subnet', 6));
  });

  test('runs one NAT gateway in dev and one per AZ in production', () => {
    expect(synth('dev').resourceCountIs('AWS::EC2::NatGateway', 1));
    expect(synth('prod').resourceCountIs('AWS::EC2::NatGateway', 3));
  });

  test('carves the VPC out of the 10.42.0.0/16 range', () => {
    synth().hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.42.0.0/16',
      EnableDnsSupport: true,
      EnableDnsHostnames: true,
    });
  });

  test('installs metrics-server as a managed add-on', () => {
    const template = synth();

    template.resourceCountIs('AWS::EKS::Addon', 1);
    template.hasResourceProperties('AWS::EKS::Addon', { AddonName: 'metrics-server' });
  });

  test('pins no add-on version, leaving the default to AWS', () => {
    // Pinning the add-on version in code means editing the construct every time
    // AWS moves the default. The trade-off is that a redeploy can move it for
    // you; environments that need reproducibility should pass an explicit
    // version instead.
    const addons = resourcesOfType(synth(), 'AWS::EKS::Addon');

    expect(addons).toHaveLength(1);
    expect(addons[0].Properties).not.toHaveProperty('AddonVersion');
  });
});
