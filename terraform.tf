terraform {
  required_version = ">= 0.13"
  backend "s3" {
    bucket  = var.TFSTATE_BUCKET
    key     = var.TFSTATE_BUCKET_KEY
    region  = var.AWS_REGION
    encrypt = true
  }
}

provider "aws" {
  region = var.AWS_REGION
}

resource "tls_private_key" "discord_instance" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "discord_key" {
  key_name   = "discord_key"
  public_key = tls_private_key.discord_instance.public_key_openssh
}

resource "local_sensitive_file" "pem_file" {
  filename             = pathexpand("~/.ssh/discord_key.pem")
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

resource "aws_instance" "discord_server" {
  ami                    = "ami-000722651477bd39b"
  instance_type          = "t3.micro"
  key_name               = aws_key_pair.discord_key.key_name
  vpc_security_group_ids = [aws_security_group.main.id]
}

resource "aws_dynamodb_table" "flipance_users" {
  name         = "FlipanceUsers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name = "FlipanceUsers"
  }
}

resource "aws_dynamodb_table" "flipance_alerts" {
  name         = "FlipanceAlerts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "address"

  attribute {
    name = "address"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  tags = {
    Name = "FlipanceAlerts"
  }
}

resource "aws_dynamodb_table" "flipance_bids" {
  name         = "FlipanceBids"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "address"

  attribute {
    name = "address"
    type = "S"
  }

  tags = {
    Name = "FlipanceBids"
  }
}
