# =============================================================================
# VISP/Tasker — Input Variables
# =============================================================================

# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "Primary AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Root domain name for the platform (e.g., taskerapp.com)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# VPC / Networking
# -----------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

# -----------------------------------------------------------------------------
# RDS (PostgreSQL)
# -----------------------------------------------------------------------------
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "visp_tasker"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "visp_admin"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum allocated storage in GB for autoscaling"
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

variable "db_backup_retention_period" {
  description = "Number of days to retain automated backups"
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Enable deletion protection on the RDS instance"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# ElastiCache (Redis)
# -----------------------------------------------------------------------------
variable "redis_node_type" {
  description = "ElastiCache node type for Redis"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes (1 for dev, 2+ for prod replication)"
  type        = number
  default     = 1
}

variable "redis_automatic_failover" {
  description = "Enable automatic failover for Redis replication group"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# ECS (Fargate)
# -----------------------------------------------------------------------------
variable "ecs_task_cpu" {
  description = "CPU units for ECS task (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 512
}

variable "ecs_task_memory" {
  description = "Memory in MiB for ECS task"
  type        = number
  default     = 1024
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks for the API service"
  type        = number
  default     = 1
}

variable "ecs_min_count" {
  description = "Minimum number of ECS tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "ecs_max_count" {
  description = "Maximum number of ECS tasks for auto-scaling"
  type        = number
  default     = 4
}

variable "ecs_worker_cpu" {
  description = "CPU units for Celery worker ECS task"
  type        = number
  default     = 256
}

variable "ecs_worker_memory" {
  description = "Memory in MiB for Celery worker ECS task"
  type        = number
  default     = 512
}

variable "ecs_worker_desired_count" {
  description = "Desired number of Celery worker tasks"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# Container Images
# -----------------------------------------------------------------------------
variable "backend_image_tag" {
  description = "Docker image tag for the backend API container"
  type        = string
  default     = "latest"
}

variable "ecr_repository_url" {
  description = "ECR repository URL for backend images"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# SSL / Domain
# -----------------------------------------------------------------------------
variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS. Leave empty to skip HTTPS listener."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Monitoring
# -----------------------------------------------------------------------------
variable "enable_enhanced_monitoring" {
  description = "Enable enhanced monitoring for RDS (60-second intervals)"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch log retention period in days"
  type        = number
  default     = 30
}

# -----------------------------------------------------------------------------
# Cost Controls
# -----------------------------------------------------------------------------
variable "enable_nat_gateway" {
  description = "Enable NAT Gateway (can be disabled for dev to save cost, but ECS in private subnets will need it)"
  type        = bool
  default     = true
}
