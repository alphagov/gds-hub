# Bootstrap

Creates the Terraform state bucket and the GitHub OIDC provider. It runs once in each AWS account: `environment = "development"` in the development account and `"production"` in the production account. This stack keeps its own state in the bucket it creates (`backend.tf`).

## Day to day

```bash
terraform init \
  -backend-config="bucket=<state bucket name>" \
  -backend-config="region=<region in terraform.tfvars, default eu-west-2>"
terraform plan
```

The bucket name is only in your git-ignored `terraform.tfvars` and the stack's outputs. Keeping it out of the repo only stops it being guessed or taken before we create it: access is controlled by IAM and the bucket policy, not by the name. Never commit it, `terraform.tfvars` or state files. Commit `.terraform.lock.hcl`.

## First run in an account

The bucket doesn't exist yet, so the stack starts with local state:

```bash
cp terraform.tfvars.example terraform.tfvars   # set environment and state_bucket_name
mv backend.tf backend.tf.off                    # keep it out of the way for now
terraform init
terraform apply
mv backend.tf.off backend.tf
terraform init -migrate-state \
  -backend-config="bucket=$(terraform output -raw state_bucket)" \
  -backend-config="region=$(terraform output -raw state_bucket_region)"
```

Answer `yes` to copy the state. Check the bucket now holds `bootstrap/terraform.tfstate`, then delete the local `terraform.tfstate` files. `backend.tf.off` is git-ignored. Check `git status` shows `backend.tf` as unchanged before you commit.

## Deleting the bucket

The bucket has `prevent_destroy`, so `terraform destroy` fails. To tear it down on purpose, delete every object version and delete marker (the bucket is versioned, so emptying the current objects isn't enough), remove the `lifecycle` block in `main.tf`, then destroy.
