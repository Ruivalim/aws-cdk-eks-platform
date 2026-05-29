#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import { PlatformStack } from '../lib/stacks/platform-stack';

const app = new App();

const region = process.env.CDK_TARGET_REGION ?? 'us-east-1';
const account = process.env.CDK_TARGET_ACCOUNT;

/**
 * Deliberately agnostic unless a target is given explicitly.
 *
 * Do not bind this to `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`: the CDK CLI
 * fills those in from whatever profile is active on the machine, which makes
 * the stack environment-specific. An environment-specific stack resolves its
 * availability zones with a live DescribeAvailabilityZones call, and that call
 * needs credentials, writes the caller's account id into `cdk.context.json`,
 * and breaks `cdk synth` in CI (and leaks the account id if committed).
 *
 * Opt in with CDK_TARGET_ACCOUNT and CDK_TARGET_REGION to pin the stack to one
 * account.
 */
const env = account ? { account, region } : undefined;

/**
 * Environments are declared explicitly rather than passed as free-form
 * arguments, so an unknown environment name fails at synth time instead of
 * silently creating a half-configured stack.
 */
const environments = {
  dev: {},
  prod: {},
} as const;

type EnvironmentName = keyof typeof environments;

const environment = (app.node.tryGetContext('environment') ?? 'dev') as EnvironmentName;

if (!(environment in environments)) {
  throw new Error(
    `Unknown environment "${environment}". Use one of: ${Object.keys(environments).join(', ')}.`,
  );
}

const stackProps = {
  env,
  environment,
  description: `EKS platform: network, cluster and node capacity (${environment})`,
};

new PlatformStack(app, `eks-platform-${environment}`, stackProps);

// Tag every resource in the app, so cost allocation reports work from day one.
Tags.of(app).add('Project', 'eks-platform');
Tags.of(app).add('Environment', environment);
Tags.of(app).add('ManagedBy', 'aws-cdk');
