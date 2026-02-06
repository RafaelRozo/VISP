# =============================================================================
# VISP/Tasker — Terraform Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# VPC
# -----------------------------------------------------------------------------
output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = aws_subnet.private[*].id
}

# -----------------------------------------------------------------------------
# ALB
# -----------------------------------------------------------------------------
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.api.dns_name
}

output "alb_url" {
  description = "Full URL of the Application Load Balancer"
  value       = "https://${aws_lb.api.dns_name}"
}

output "alb_zone_id" {
  description = "Hosted zone ID of the ALB (for Route53 alias records)"
  value       = aws_lb.api.zone_id
}

# -----------------------------------------------------------------------------
# ECS
# -----------------------------------------------------------------------------
output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_api_service_name" {
  description = "Name of the API ECS service"
  value       = aws_ecs_service.api.name
}

output "ecs_worker_service_name" {
  description = "Name of the Celery worker ECS service"
  value       = aws_ecs_service.worker.name
}

output "ecr_repository_url" {
  description = "URL of the ECR repository for backend images"
  value       = aws_ecr_repository.backend.repository_url
}

# -----------------------------------------------------------------------------
# RDS
# -----------------------------------------------------------------------------
output "rds_endpoint" {
  description = "RDS instance endpoint (hostname:port)"
  value       = aws_db_instance.main.endpoint
}

output "rds_hostname" {
  description = "RDS instance hostname"
  value       = aws_db_instance.main.address
}

output "rds_port" {
  description = "RDS instance port"
  value       = aws_db_instance.main.port
}

output "rds_database_name" {
  description = "Name of the PostgreSQL database"
  value       = aws_db_instance.main.db_name
}

# -----------------------------------------------------------------------------
# ElastiCache (Redis)
# -----------------------------------------------------------------------------
output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = local.is_prod ? aws_elasticache_replication_group.redis[0].primary_endpoint_address : aws_elasticache_cluster.redis[0].cache_nodes[0].address
}

output "redis_port" {
  description = "Redis port"
  value       = 6379
}

# -----------------------------------------------------------------------------
# S3
# -----------------------------------------------------------------------------
output "s3_uploads_bucket" {
  description = "Name of the uploads S3 bucket"
  value       = aws_s3_bucket.uploads.id
}

output "s3_static_bucket" {
  description = "Name of the static assets S3 bucket"
  value       = aws_s3_bucket.static.id
}

# -----------------------------------------------------------------------------
# CloudFront
# -----------------------------------------------------------------------------
output "cloudfront_domain" {
  description = "CloudFront distribution domain name for static assets"
  value       = aws_cloudfront_distribution.static.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.static.id
}

# -----------------------------------------------------------------------------
# Secrets Manager
# -----------------------------------------------------------------------------
output "secrets_db_credentials_arn" {
  description = "ARN of the database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "secrets_app_secrets_arn" {
  description = "ARN of the application secrets"
  value       = aws_secretsmanager_secret.app_secrets.arn
}

# -----------------------------------------------------------------------------
# CloudWatch
# -----------------------------------------------------------------------------
output "cloudwatch_log_group_api" {
  description = "CloudWatch log group for the API service"
  value       = aws_cloudwatch_log_group.api.name
}

output "cloudwatch_log_group_worker" {
  description = "CloudWatch log group for the Celery worker"
  value       = aws_cloudwatch_log_group.worker.name
}

# -----------------------------------------------------------------------------
# Service Discovery
# -----------------------------------------------------------------------------
output "service_discovery_namespace" {
  description = "Service discovery namespace for internal communication"
  value       = aws_service_discovery_private_dns_namespace.main.name
}
