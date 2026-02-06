# =============================================================================
# VISP/Tasker — RDS PostgreSQL
# =============================================================================
# Architecture:
#   - PostgreSQL 15 on RDS
#   - Private subnet group (no public access)
#   - Encrypted storage with KMS
#   - Multi-AZ for prod, single-AZ for dev/staging
#   - Automated backups with configurable retention
#   - Custom parameter group for performance tuning
#   - Credentials stored in Secrets Manager
# =============================================================================

# -----------------------------------------------------------------------------
# DB Subnet Group
# -----------------------------------------------------------------------------
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

# -----------------------------------------------------------------------------
# Security Group — RDS
# -----------------------------------------------------------------------------
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Security group for RDS PostgreSQL — only ECS tasks can connect"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    description = "No outbound needed for RDS"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-rds-sg"
  }
}

# -----------------------------------------------------------------------------
# Parameter Group — PostgreSQL 15 Tuning
# -----------------------------------------------------------------------------
resource "aws_db_parameter_group" "main" {
  name   = "${local.name_prefix}-pg15-params"
  family = "postgres15"

  # Connection management
  parameter {
    name  = "max_connections"
    value = local.is_prod ? "200" : "100"
  }

  # Memory tuning (prod gets larger buffers)
  parameter {
    name  = "shared_buffers"
    value = local.is_prod ? "{DBInstanceClassMemory/4}" : "{DBInstanceClassMemory/8}"
  }

  parameter {
    name  = "effective_cache_size"
    value = local.is_prod ? "{DBInstanceClassMemory*3/4}" : "{DBInstanceClassMemory/2}"
  }

  parameter {
    name  = "work_mem"
    value = local.is_prod ? "16384" : "4096"
  }

  parameter {
    name  = "maintenance_work_mem"
    value = local.is_prod ? "524288" : "131072"
  }

  # WAL configuration
  parameter {
    name  = "wal_buffers"
    value = "8192"
  }

  # Query logging — log queries slower than 1 second
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  # Autovacuum tuning
  parameter {
    name  = "autovacuum_max_workers"
    value = local.is_prod ? "5" : "3"
  }

  parameter {
    name  = "autovacuum_naptime"
    value = "30"
  }

  # Enable pg_stat_statements for query analysis
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "pg_stat_statements.track"
    value = "all"
  }

  # Connection timeout
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "300000"
  }

  tags = {
    Name = "${local.name_prefix}-pg15-params"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# KMS Key for RDS Encryption
# -----------------------------------------------------------------------------
resource "aws_kms_key" "rds" {
  description             = "KMS key for VISP ${var.environment} RDS encryption"
  deletion_window_in_days = local.is_prod ? 30 : 7
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-rds-kms"
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.name_prefix}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

# -----------------------------------------------------------------------------
# IAM Role for Enhanced Monitoring
# -----------------------------------------------------------------------------
resource "aws_iam_role" "rds_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0

  name = "${local.name_prefix}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-rds-monitoring-role"
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0

  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# -----------------------------------------------------------------------------
# RDS Instance — PostgreSQL 15
# -----------------------------------------------------------------------------
resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  # Engine
  engine               = "postgres"
  engine_version       = "15"
  instance_class       = var.db_instance_class
  parameter_group_name = aws_db_parameter_group.main.name

  # Storage
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  # Database
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  port                   = 5432

  # Availability
  multi_az = var.db_multi_az

  # Backups
  backup_retention_period = var.db_backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot   = true

  # Monitoring
  monitoring_interval          = var.enable_enhanced_monitoring ? 60 : 0
  monitoring_role_arn          = var.enable_enhanced_monitoring ? aws_iam_role.rds_monitoring[0].arn : null
  performance_insights_enabled = local.is_prod
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Lifecycle
  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = !local.is_prod
  final_snapshot_identifier = local.is_prod ? "${local.name_prefix}-postgres-final" : null
  apply_immediately         = !local.is_prod

  # Auto minor version upgrades
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

# -----------------------------------------------------------------------------
# Random Password for DB
# -----------------------------------------------------------------------------
resource "random_password" "db_password" {
  length  = 32
  special = true
  # Avoid characters that can cause issues in connection strings
  override_special = "!#$%&*()-_=+[]{}|:,.<>?"
}

# -----------------------------------------------------------------------------
# CloudWatch Alarms — RDS
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization is above 80% for 15 minutes"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  tags = {
    Name = "${local.name_prefix}-rds-high-cpu"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.name_prefix}-rds-low-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120 # 5 GB in bytes
  alarm_description   = "RDS free storage space is below 5 GB"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  tags = {
    Name = "${local.name_prefix}-rds-low-storage"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${local.name_prefix}-rds-high-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = local.is_prod ? 150 : 80
  alarm_description   = "RDS connection count is high"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  tags = {
    Name = "${local.name_prefix}-rds-high-connections"
  }
}
