import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CdkLspTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /*
     * LSPのCodeLens確認用。
     *
     * Bucket Constructから、設定によって以下のような
     * CloudFormationリソースが生成されます。
     *
     * - AWS::S3::Bucket
     * - AWS::S3::BucketPolicy
     */
    const bucket = new s3.Bucket(this, 'DemoBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });

    /*
     * Synthエラー確認用
     *
     * publicReadAccess: true のコメントを外して保存すると、
     * blockPublicAccess のデフォルト設定と矛盾するため Synth がエラーになり、
     * この行にエラー診断が表示されることを確認します。
     */
    const bucket2 = new s3.Bucket(this, 'DemoBucket2', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // publicReadAccess: true,
    });
    const bucket3 = new s3.Bucket(this, 'DemoBucket3', {
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    const bucket4 = new s3.Bucket(this, 'DemoBucket4', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      // publicReadAccess: true,
    });
    const queue = new sqs.Queue(this, 'DemoQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
    });
  }
}
