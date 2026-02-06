# =============================================================================
# VISP/Tasker — Production Environment
# =============================================================================
# Full production resources with high availability.
# Multi-AZ RDS, Redis replication, auto-scaling ECS.
# Enhanced monitoring, longer backup retention.
# Estimated monthly cost: ~$600-900 USD (scales with traffic)
# =============================================================================

environment = "prod"
aws_region  = "us-east-1"

# -----------------------------------------------------------------------------
# VPC / Networking
# -----------------------------------------------------------------------------
vpc_cidr             = "10.1.0.0/16"
public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24"]
private_subnet_cidrs = ["10.1.10.0/24", "10.1.11.0/24"]
enable_nat_gateway   = true

# -----------------------------------------------------------------------------
# RDS (PostgreSQL)
# -----------------------------------------------------------------------------
db_instance_class          = "db.r6g.large"
db_name                    = "visp_tasker"
db_username                = "visp_admin"
db_allocated_storage       = 100
db_max_allocated_storage   = 500
db_multi_az                = true
db_backup_retention_period = 30
db_deletion_protection     = true

# -----------------------------------------------------------------------------
# ElastiCache (Redis)
# -----------------------------------------------------------------------------
redis_node_type            = "cache.r6g.large"
redis_num_cache_nodes      = 2
redis_automatic_failover   = true

# -----------------------------------------------------------------------------
# ECS (Fargate) — API
# -----------------------------------------------------------------------------
ecs_task_cpu      = 1024
ecs_task_memory   = 2048
ecs_desired_count = 2
ecs_min_count     = 2
ecs_max_count     = 10

# -----------------------------------------------------------------------------
# ECS (Fargate) — Worker
# -----------------------------------------------------------------------------
ecs_worker_cpu           = 512
ecs_worker_memory        = 1024
ecs_worker_desired_count = 2

# -----------------------------------------------------------------------------
# Container Images
# -----------------------------------------------------------------------------
backend_image_tag = "latest"

# -----------------------------------------------------------------------------
# Monitoring
# -----------------------------------------------------------------------------
enable_enhanced_monitoring = true
log_retention_days         = 90

# -----------------------------------------------------------------------------
# SSL — MUST set the ACM certificate ARN for production HTTPS
# -----------------------------------------------------------------------------
# acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID"
acm_certificate_arn = ""
domain_name         = "taskerapp.com"
