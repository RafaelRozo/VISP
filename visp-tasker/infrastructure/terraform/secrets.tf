# =============================================================================
# VISP/Tasker — AWS Secrets Manager
# =============================================================================
# Secrets:
#   1. Database credentials (auto-generated password, connection string)
#   2. Application secrets (JWT, Stripe, Google Maps, Firebase)
# All secrets are encrypted, tagged, and have rotation recommendations
# =============================================================================

# -----------------------------------------------------------------------------
# Database Credentials Secret
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${local.name_prefix}/database/credentials"
  description = "PostgreSQL database credentials for VISP ${var.environment}"

  recovery_window_in_days = local.is_prod ? 30 : 0

  tags = {
    Name        = "${local.name_prefix}-db-credentials"
    SecretType  = "database"
    AutoRotate  = "recommended"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username          = var.db_username
    password          = random_password.db_password.result
    host              = aws_db_instance.main.address
    port              = aws_db_instance.main.port
    dbname            = var.db_name
    engine            = "postgres"
    connection_string = "postgresql+asyncpg://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
  })
}

# -----------------------------------------------------------------------------
# Application Secrets
# -----------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "${local.name_prefix}/application/secrets"
  description = "Application secrets for VISP ${var.environment} (JWT, Stripe, Maps, Firebase)"

  recovery_window_in_days = local.is_prod ? 30 : 0

  tags = {
    Name       = "${local.name_prefix}-app-secrets"
    SecretType = "application"
  }
}

# Generate a strong JWT secret
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id

  # NOTE: Placeholder values — must be updated manually or via CI/CD
  # after initial deployment. Stripe keys, Google Maps key, and Firebase
  # credentials should NEVER be committed to version control.
  secret_string = jsonencode({
    jwt_secret               = random_password.jwt_secret.result
    stripe_secret_key        = "sk_test_PLACEHOLDER_UPDATE_ME"
    stripe_webhook_secret    = "whsec_PLACEHOLDER_UPDATE_ME"
    stripe_publishable_key   = "pk_test_PLACEHOLDER_UPDATE_ME"
    google_maps_api_key      = "PLACEHOLDER_UPDATE_ME"
    firebase_credentials_json = "{}"
  })

  lifecycle {
    # Prevent Terraform from reverting manual secret updates
    ignore_changes = [secret_string]
  }
}

# -----------------------------------------------------------------------------
# Secrets Manager Rotation — Database Credentials
# NOTE: Rotation Lambda is recommended for production. This creates the
# rotation configuration structure. The actual Lambda function for
# rotation should be deployed separately or use AWS-provided templates.
# -----------------------------------------------------------------------------

# Rotation schedule placeholder — uncomment when Lambda is deployed
# resource "aws_secretsmanager_secret_rotation" "db_credentials" {
#   count = local.is_prod ? 1 : 0
#
#   secret_id           = aws_secretsmanager_secret.db_credentials.id
#   rotation_lambda_arn = aws_lambda_function.secret_rotation.arn
#
#   rotation_rules {
#     automatically_after_days = 30
#   }
# }

# -----------------------------------------------------------------------------
# KMS Key for Secrets Encryption (optional, uses default AWS key otherwise)
# -----------------------------------------------------------------------------
resource "aws_kms_key" "secrets" {
  count = local.is_prod ? 1 : 0

  description             = "KMS key for VISP ${var.environment} Secrets Manager encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootAccountAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${local.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowSecretsManagerAccess"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService"    = "secretsmanager.${var.aws_region}.amazonaws.com"
            "kms:CallerAccount" = local.account_id
          }
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-secrets-kms"
  }
}

resource "aws_kms_alias" "secrets" {
  count = local.is_prod ? 1 : 0

  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets[0].key_id
}
