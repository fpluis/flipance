variable "AWS_REGION" {
  type        = string
  description = "AWS region where the infrastructure will be deployed"
  default     = "us-east-1"
}

variable "TFSTATE_BUCKET" {
  type        = string
  description = "S3 Bucket used to store terraform's state"
}

variable "TFSTATE_BUCKET_KEY" {
  type        = string
  description = "Key for the S3 Bucket used to store terraform's state"
  default     = "flipance"
}

variable "EC2_INSTANCE_TYPE" {
  type        = string
  description = "The instance type for the server that will host the bot. You can find the pricing details here https://aws.amazon.com/ec2/pricing/on-demand/"
}
