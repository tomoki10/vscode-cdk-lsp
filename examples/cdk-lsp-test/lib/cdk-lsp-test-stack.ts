import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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
    /*
     * LSPのDiagnostics確認用。
     *
     * NODEJS_18_Xは非推奨ランタイムなので、
     * Comprehensive Validationが対応していれば
     * ランタイムに関する警告が表示される候補です。
     */
    const fn = new lambda.Function(this, 'DeprecatedRuntimeFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async () => {
          return {
            statusCode: 200,
            body: "Hello from CDK LSP demo"
          };
        };
      `),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
    });

    bucket.grantRead(fn);

    /*
     * ハードエラー確認用。
     *
     * falseからtrueへ変更して保存すると、
     * 無効なFargateのCPU・メモリ構成によって
     * Synthが失敗することを期待します。
     */

    const enableInvalidConfiguration = true;

    if (enableInvalidConfiguration) {
      new ecs.FargateTaskDefinition(this, 'InvalidTaskDefinition', {
        cpu: 256,

        // CPU 256に対して8192 MiBは無効な組み合わせ
        memoryLimitMiB: 8192,
      });
    }
  }
}
