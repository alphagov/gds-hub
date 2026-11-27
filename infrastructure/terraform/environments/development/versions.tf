terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "gds-hub"
      ManagedBy   = "terraform"
      Stack       = "development"
      Environment = "development"
    }
  }
}

# CloudFront's web ACL must be created in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "gds-hub"
      ManagedBy   = "terraform"
      Stack       = "development"
      Environment = "development"
    }
  }
}
