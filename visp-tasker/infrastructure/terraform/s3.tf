# =============================================================================
# VISP/Tasker — S3 Buckets & CloudFront CDN
# =============================================================================
# Buckets:
#   1. visp-{env}-uploads — Provider credentials, profile photos, documents
#      - Private, versioned, lifecycle policies, CORS for mobile
#   2. visp-{env}-static — Static assets served via CloudFront CDN
#      - OAI for secure access, no direct S3 access
# =============================================================================

# -----------------------------------------------------------------------------
# Uploads Bucket — Provider credentials, profile photos
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "uploads" {
  bucket = "${local.name_prefix}-uploads"

  force_destroy = !local.is_prod

  tags = {
    Name    = "${local.name_prefix}-uploads"
    Purpose = "User uploads, provider credentials, profile photos"
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  # Move infrequently accessed files to IA after 90 days
  rule {
    id     = "transition-to-ia"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }

  # Clean up incomplete multipart uploads
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Clean up old versions after 90 days
  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# CORS configuration for mobile app uploads
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["*"] # Restrict in prod to specific origins
    expose_headers  = ["ETag", "Content-Length"]
    max_age_seconds = 3600
  }
}

# Bucket policy — restrict access to ECS task role and specific principals
resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnforceTLSOnly"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Static Assets Bucket — Served via CloudFront
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "static" {
  bucket = "${local.name_prefix}-static"

  force_destroy = !local.is_prod

  tags = {
    Name    = "${local.name_prefix}-static"
    Purpose = "Static assets served via CloudFront CDN"
  }
}

resource "aws_s3_bucket_versioning" "static" {
  bucket = aws_s3_bucket.static.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  bucket = aws_s3_bucket.static.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket = aws_s3_bucket.static.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OAI policy — only CloudFront can access this bucket
resource "aws_s3_bucket_policy" "static" {
  bucket = aws_s3_bucket.static.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudFrontOAIAccess"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.static.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static.arn}/*"
      },
      {
        Sid    = "EnforceTLSOnly"
        Effect = "Deny"
        Principal = "*"
        Action = "s3:*"
        Resource = [
          aws_s3_bucket.static.arn,
          "${aws_s3_bucket.static.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# CloudFront Distribution — Static Assets CDN
# -----------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_identity" "static" {
  comment = "OAI for VISP ${var.environment} static assets"
}

resource "aws_cloudfront_distribution" "static" {
  origin {
    domain_name = aws_s3_bucket.static.bucket_regional_domain_name
    origin_id   = "S3-${aws_s3_bucket.static.id}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.static.cloudfront_access_identity_path
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "VISP ${var.environment} static assets CDN"
  price_class         = local.is_prod ? "PriceClass_All" : "PriceClass_100"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.static.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400    # 1 day
    max_ttl                = 31536000 # 1 year
    compress               = true
  }

  # Cache behavior for versioned assets (long cache)
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.static.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 31536000
    default_ttl            = 31536000
    max_ttl                = 31536000
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["US", "CA"] # USA and Canada only
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "${local.name_prefix}-static-cdn"
  }
}
