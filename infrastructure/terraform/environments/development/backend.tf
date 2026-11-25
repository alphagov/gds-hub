# The bucket and region are not committed. Pass them to terraform init:
#
#   terraform init \
#     -backend-config="bucket=<state bucket name>" \
#     -backend-config="region=<state bucket region>"
#
# Both are outputs of the bootstrap stack.
terraform {
  backend "s3" {
    key          = "environments/development/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
