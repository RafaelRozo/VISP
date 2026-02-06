# =============================================================================
# VISP/Tasker — Development Environment
# =============================================================================
# Minimal resources for development and testing.
# Single AZ, no Multi-AZ, no enhanced monitoring.
# Estimated monthly cost: ~$80-120 USD
# =============================================================================

environment = "dev"
aws_region  = "us-east-1"

# -----------------------------------------------------------------------------
# VPC / Networking
# -----------------------------------------------------------------------------
vpc_cidr             = "10.0.0.0/16"
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24"]
enable_nat_gateway   = true

# -----------------------------------------------------------------------------
# RDS (PostgreSQL)
# -----------------------------------------------------------------------------
db_instance_class          = "db.t3.micro"
db_name                    = "visp_tasker"
db_username                = "visp_admin"
db_allocated_storage       = 20
db_max_allocated_storage   = 50
db_multi_az                = false
db_backup_retention_period = 7
db_deletion_protection     = false

# -----------------------------------------------------------------------------
# ElastiCache (Redis)
# -----------------------------------------------------------------------------
redis_node_type            = "cache.t3.micro"
redis_num_cache_nodes      = 1
redis_automatic_failover   = false

# -----------------------------------------------------------------------------
# ECS (Fargate) — API
# -----------------------------------------------------------------------------
ecs_task_cpu      = 512
ecs_task_memory   = 1024
ecs_desired_count = 1
ecs_min_count     = 1
ecs_max_count     = 4

# -----------------------------------------------------------------------------
# ECS (Fargate) — Worker
# -----------------------------------------------------------------------------
ecs_worker_cpu           = 256
ecs_worker_memory        = 512
ecs_worker_desired_count = 1

# -----------------------------------------------------------------------------
# Container Images
# -----------------------------------------------------------------------------
backend_image_tag = "latest"

# -----------------------------------------------------------------------------
# Monitoring
# -----------------------------------------------------------------------------
enable_enhanced_monitoring = false
log_retention_days         = 14

# -----------------------------------------------------------------------------
# SSL (leave empty for dev — ALB will serve HTTP only)
# -----------------------------------------------------------------------------
acm_certificate_arn = ""
domain_name         = ""
