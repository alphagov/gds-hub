The research agent has written its feasibility review to docs/research/infrastructure-plan-feasibility.md. I haven't read the file myself, so what follows is the agent's summary. It will notify again, because my message telling it to narrow its fetching arrived after it had finished, so it's being resumed with that message. The file may change.

Verdicts

- Feasible with changes: Secrets Manager, Express Mode, RDS and TLS, GitHub OIDC, Terraform state, and the security posture (development only).
- Defects found: the plan's errors and ordering.

Top three changes

1. Replace the -target two-stage first apply.
   - The stage-1 deploy would fail. The workflow runs the schema migration, which needs the RDS instance, secret and task definition that stage 1 doesn't create, and then updates a service that doesn't exist yet.
   - Use a create_service variable instead. Apply 1 builds everything except the service and the WAF association. A push-and-migrate-only workflow run follows, and apply 2 creates the service.
2. Handle password rotation.
   - ECS injects secrets only at task start, and RDS rotates every 7 days by default, so running tasks will fail to reconnect.
   - Pick one: turn rotation off in development, force a deployment after each rotation, or read the secret at runtime.
3. Fix three assumptions.
   - The task security group's "outbound 443 and 5432 only" limit probably has no effect. The group Express creates allows all outbound, and security groups add together. Confirm this on the first apply.
   - The load balancer ARN may be findable with an aws_lb data source on the AmazonECSManaged=true tag. That would remove the manual alb_arn step and shorten the unprotected window. The exact tags are unverified.
   - Pin the AWS provider to 6.50 or later and require Terraform 1.11 or later.

Smaller findings

- rds.force_ssl is already 1 by default on PostgreSQL 15 and later.
- Newer GitHub repositories use an immutable OIDC sub claim, which the trust policy must match.
- Every one-off task needs a public IP, because there is no NAT.

Unverified, so check these yourself

- Whether PostgreSQL 18 is offered in eu-west-2. Run aws rds describe-db-engine-versions --engine postgres --region eu-west-2.
- Whether the RDS-managed secret has only the username and password keys.
- Whether Express Mode accepts the <arn>:username:: form in secret.
- What Express still creates when you supply your own security group.

The last two are why I'd treat the Secrets Manager section I wrote into infrastructure-plan.md as provisional until you've checked it on a first apply.

The research file isn't git-ignored, so decide whether you want it committed.

I haven't changed infrastructure-plan.md to reflect these findings. I'll make the three top changes there once the agent's second notification arrives, if you want me to.
