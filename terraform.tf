# The configuration file to deploy the AWS infrastructure.
# It will create an EC2 instance and start it with a custom
# installation script.
# IMPORTANT NOTE: Deploying this template will make you incur in a
# monthly expense.

terraform {
  required_version = ">= 0.13"
  backend "s3" {}
}

provider "aws" {
  region = var.AWS_REGION
}

resource "tls_private_key" "discord_instance" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "flipance" {
  key_name   = "flipance"
  public_key = tls_private_key.discord_instance.public_key_openssh
}

resource "local_sensitive_file" "pem_file" {
  filename             = pathexpand("~/.ssh/flipance.pem")
  file_permission      = "600"
  directory_permission = "700"
  content              = tls_private_key.discord_instance.private_key_pem
}

resource "aws_security_group" "main" {
  egress = [
    {
      cidr_blocks      = ["0.0.0.0/0", ]
      description      = ""
      from_port        = 0
      ipv6_cidr_blocks = []
      prefix_list_ids  = []
      protocol         = "-1"
      security_groups  = []
      self             = false
      to_port          = 0
    }
  ]
  ingress = [
    {
      cidr_blocks      = ["0.0.0.0/0", ]
      description      = ""
      from_port        = 22
      ipv6_cidr_blocks = []
      prefix_list_ids  = []
      protocol         = "tcp"
      security_groups  = []
      self             = false
      to_port          = 22
    }
  ]
}

resource "aws_ssm_parameter" "ETHERSCAN_API_KEY" {
  name  = "/prod/ETHERSCAN_API_KEY"
  type  = "SecureString"
  value = var.ETHERSCAN_API_KEY
}

resource "aws_ssm_parameter" "GITHUB_TOKEN" {
  name  = "/prod/GITHUB_TOKEN"
  type  = "SecureString"
  value = var.GITHUB_TOKEN
}

resource "aws_ssm_parameter" "INFURA_PROJECT_ID" {
  name  = "/prod/INFURA_PROJECT_ID"
  type  = "SecureString"
  value = var.INFURA_PROJECT_ID
}

resource "aws_ssm_parameter" "POCKET_PROJECT_ID" {
  name  = "/prod/POCKET_PROJECT_ID"
  type  = "SecureString"
  value = var.POCKET_PROJECT_ID
}

resource "aws_ssm_parameter" "POCKET_SECRET_KEY" {
  name  = "/prod/POCKET_SECRET_KEY"
  type  = "SecureString"
  value = var.POCKET_SECRET_KEY
}

resource "aws_ssm_parameter" "ALCHEMY_API_KEY" {
  name  = "/prod/ALCHEMY_API_KEY"
  type  = "SecureString"
  value = var.ALCHEMY_API_KEY
}

resource "aws_ssm_parameter" "DISCORD_CLIENT_ID" {
  name  = "/prod/DISCORD_CLIENT_ID"
  type  = "SecureString"
  value = var.DISCORD_CLIENT_ID
}

resource "aws_ssm_parameter" "DISCORD_BOT_TOKEN" {
  name  = "/prod/DISCORD_BOT_TOKEN"
  type  = "SecureString"
  value = var.DISCORD_BOT_TOKEN
}

resource "aws_ssm_parameter" "DISCORD_CLIENT_ID_TEST" {
  name  = "/prod/DISCORD_CLIENT_ID_TEST"
  type  = "SecureString"
  value = var.DISCORD_CLIENT_ID_TEST
}

resource "aws_ssm_parameter" "DISCORD_BOT_TOKEN_TEST" {
  name  = "/prod/DISCORD_BOT_TOKEN_TEST"
  type  = "SecureString"
  value = var.DISCORD_BOT_TOKEN_TEST
}

resource "aws_ssm_parameter" "MORALIS_SERVER_URL" {
  name  = "/prod/MORALIS_SERVER_URL"
  type  = "SecureString"
  value = var.MORALIS_SERVER_URL
}

resource "aws_ssm_parameter" "MORALIS_APP_ID" {
  name  = "/prod/MORALIS_APP_ID"
  type  = "SecureString"
  value = var.MORALIS_APP_ID
}

resource "aws_ssm_parameter" "MORALIS_MASTER_KEY" {
  name  = "/prod/MORALIS_MASTER_KEY"
  type  = "SecureString"
  value = var.MORALIS_MASTER_KEY
}

resource "aws_ssm_parameter" "NFT_SCAN_API_ID" {
  name  = "/prod/NFT_SCAN_API_ID"
  type  = "SecureString"
  value = var.NFT_SCAN_API_ID
}

resource "aws_ssm_parameter" "NFT_SCAN_SECRET" {
  name  = "/prod/NFT_SCAN_SECRET"
  type  = "SecureString"
  value = var.NFT_SCAN_SECRET
}

resource "aws_ssm_parameter" "POSTGRES_PASSWORD" {
  name  = "/prod/POSTGRES_PASSWORD"
  type  = "SecureString"
  value = var.POSTGRES_PASSWORD
}

data "template_file" "userdata" {
  template = file("${path.module}/scripts/startup.sh")
  vars = {
    GITHUB_REPO_IDENTIFIER       = var.GITHUB_REPO_IDENTIFIER
    REPO_IS_PUBLIC               = var.GITHUB_TOKEN == ""
    GITHUB_TOKEN_PARAM           = aws_ssm_parameter.GITHUB_TOKEN.name
    ETHERSCAN_API_KEY_PARAM      = aws_ssm_parameter.ETHERSCAN_API_KEY.name
    INFURA_PROJECT_ID_PARAM      = aws_ssm_parameter.INFURA_PROJECT_ID.name
    POCKET_PROJECT_ID_PARAM      = aws_ssm_parameter.POCKET_PROJECT_ID.name
    POCKET_SECRET_KEY_PARAM      = aws_ssm_parameter.POCKET_SECRET_KEY.name
    ALCHEMY_API_KEY_PARAM        = aws_ssm_parameter.ALCHEMY_API_KEY.name
    DISCORD_CLIENT_ID_PARAM      = aws_ssm_parameter.DISCORD_CLIENT_ID.name
    DISCORD_BOT_TOKEN_PARAM      = aws_ssm_parameter.DISCORD_BOT_TOKEN.name
    DISCORD_CLIENT_ID_TEST_PARAM = aws_ssm_parameter.DISCORD_CLIENT_ID_TEST.name
    DISCORD_BOT_TOKEN_TEST_PARAM = aws_ssm_parameter.DISCORD_BOT_TOKEN_TEST.name
    MORALIS_SERVER_URL_PARAM     = aws_ssm_parameter.MORALIS_SERVER_URL.name
    MORALIS_APP_ID_PARAM         = aws_ssm_parameter.MORALIS_APP_ID.name
    MORALIS_MASTER_KEY_PARAM     = aws_ssm_parameter.MORALIS_MASTER_KEY.name
    NFT_SCAN_API_ID_PARAM        = aws_ssm_parameter.NFT_SCAN_API_ID.name
    NFT_SCAN_SECRET_PARAM        = aws_ssm_parameter.NFT_SCAN_SECRET.name
    DB_HOSTNAME                  = var.DB_HOSTNAME
    DB_PORT                      = var.DB_PORT
    POSTGRES_USERNAME                  = var.POSTGRES_USERNAME
    DB_NAME                      = var.DB_NAME
    POSTGRES_PASSWORD                  = aws_ssm_parameter.POSTGRES_PASSWORD.name
    MAX_NICKNAME_LENGTH          = var.MAX_NICKNAME_LENGTH
    MAX_OFFER_FLOOR_DIFFERENCE   = var.MAX_OFFER_FLOOR_DIFFERENCE
    DEFAULT_USER_ALERT_LIMIT     = var.DEFAULT_USER_ALERT_LIMIT
    DEFAULT_SERVER_ALERT_LIMIT   = var.DEFAULT_SERVER_ALERT_LIMIT
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_policy" "ec2_policy" {
  name        = "ec2_policy"
  path        = "/"
  description = "Grant EC2 permission to access secure parameters"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "ssm:GetParameters",
          "ssm:GetParameter",
          "ssm:GetParametersByPath"
        ],
        Resource = "arn:aws:ssm:${var.AWS_REGION}:${data.aws_caller_identity.current.account_id}:*"
      }
    ]
  })
}

resource "aws_iam_role" "ec2_role" {
  name = "ec2_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_policy_attachment" "ec2_policy_role" {
  name       = "ec2_attachment"
  roles      = [aws_iam_role.ec2_role.name]
  policy_arn = aws_iam_policy.ec2_policy.arn
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "ec2_profile"
  role = aws_iam_role.ec2_role.name
}

resource "aws_instance" "discord_server" {
  ami                    = "ami-000722651477bd39b"
  instance_type          = var.EC2_INSTANCE_TYPE
  key_name               = aws_key_pair.flipance.key_name
  vpc_security_group_ids = [aws_security_group.main.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  user_data              = data.template_file.userdata.rendered
}

resource "aws_eip" "elastic_ip" {
  instance = aws_instance.discord_server.id
  vpc      = true
}
