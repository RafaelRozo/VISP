# =============================================================================
# VISP/Tasker — ElastiCache Redis
# =============================================================================
# Architecture:
#   - Redis 7.x engine
#   - Dev: Single-node cluster (cost-effective)
#   - Prod: Replication group with automatic failover (HA)
#   - Private subnet group
#   - At-rest and in-transit encryption
#   - Security group: only ECS tasks can connect
# =============================================================================

# -----------------------------------------------------------------------------
# Subnet Group
# -----------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name_prefix}-redis-subnet-group"
  }
}

# -----------------------------------------------------------------------------
# Security Group — Redis
# -----------------------------------------------------------------------------
resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis-sg"
  description = "Security group for ElastiCache Redis — only ECS tasks can connect"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    description = "No outbound needed for Redis"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-redis-sg"
  }
}

# -----------------------------------------------------------------------------
# Parameter Group — Redis 7
# -----------------------------------------------------------------------------
resource "aws_elasticache_parameter_group" "main" {
  name   = "${local.name_prefix}-redis7-params"
  family = "redis7"

  # Eviction policy — evict least recently used keys when memory is full
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  # Enable keyspace notifications for pub/sub and expiry events
  parameter {
    name  = "notify-keyspace-events"
    value = "Ex"
  }

  # Timeout for idle connections (5 minutes)
  parameter {
    name  = "timeout"
    value = "300"
  }

  tags = {
    Name = "${local.name_prefix}-redis7-params"
  }
}

# -----------------------------------------------------------------------------
# Redis Cluster — Dev/Staging (single node, no replication)
# -----------------------------------------------------------------------------
resource "aws_elasticache_cluster" "redis" {
  count = local.is_prod ? 0 : 1

  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  # Maintenance
  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "03:00-04:00"
  snapshot_retention_limit = 3

  # Encryption
  transit_encryption_enabled = false # No TLS for dev to simplify debugging
  at_rest_encryption_enabled = true

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

# -----------------------------------------------------------------------------
# Redis Replication Group — Prod (multi-node with automatic failover)
# -----------------------------------------------------------------------------
resource "aws_elasticache_replication_group" "redis" {
  count = local.is_prod ? 1 : 0

  replication_group_id = "${local.name_prefix}-redis"
  description          = "VISP ${var.environment} Redis replication group"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  # Replication
  num_cache_clusters   = var.redis_num_cache_nodes
  automatic_failover_enabled = var.redis_automatic_failover
  multi_az_enabled     = var.redis_automatic_failover

  # Maintenance
  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "03:00-04:00"
  snapshot_retention_limit = 7

  # Encryption
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms — Redis
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "${local.name_prefix}-redis-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 75
  alarm_description   = "Redis engine CPU utilization is above 75% for 15 minutes"

  dimensions = {
    CacheClusterId = local.is_prod ? "${local.name_prefix}-redis-001" : "${local.name_prefix}-redis"
  }

  tags = {
    Name = "${local.name_prefix}-redis-high-cpu"
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.name_prefix}-redis-high-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Redis memory usage is above 80%"

  dimensions = {
    CacheClusterId = local.is_prod ? "${local.name_prefix}-redis-001" : "${local.name_prefix}-redis"
  }

  tags = {
    Name = "${local.name_prefix}-redis-high-memory"
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  alarm_name          = "${local.name_prefix}-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Redis is evicting keys — memory pressure detected"

  dimensions = {
    CacheClusterId = local.is_prod ? "${local.name_prefix}-redis-001" : "${local.name_prefix}-redis"
  }

  tags = {
    Name = "${local.name_prefix}-redis-evictions"
  }
}
