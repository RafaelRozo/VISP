# =============================================================================
# VISP/Tasker — Root Terraform Configuration
# =============================================================================
# Home services marketplace platform infrastructure
# Supports multi-environment (dev/staging/prod) deployments
# Primary: us-east-1 | Secondary: ca-central-1 (Canada)
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # Remote state in S3 with DynamoDB locking
  # Initialize with: terraform init -backend-config=environments/<env>.backend.hcl
  backend "s3" {
    bucket         = "visp-tasker-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "visp-tasker-terraform-locks"
  }
}

# -----------------------------------------------------------------------------
# AWS Provider — Primary Region
# -----------------------------------------------------------------------------
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "visp-tasker"
      Environment = var.environment
      ManagedBy   = "terraform"
      Team        = "platform"
    }
  }
}

# Secondary provider for Canada region (cross-region replication, DR)
provider "aws" {
  alias  = "canada"
  region = "ca-central-1"

  default_tags {
    tags = {
      Project     = "visp-tasker"
      Environment = var.environment
      ManagedBy   = "terraform"
      Team        = "platform"
    }
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Local Values
# -----------------------------------------------------------------------------
locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  az_count = min(length(data.aws_availability_zones.available.names), 2)
  azs      = slice(data.aws_availability_zones.available.names, 0, local.az_count)

  is_prod = var.environment == "prod"

  common_tags = {
    Project     = "visp-tasker"
    Environment = var.environment
  }

  # Resource naming convention: visp-{environment}-{resource}
  name_prefix = "visp-${var.environment}"
}
