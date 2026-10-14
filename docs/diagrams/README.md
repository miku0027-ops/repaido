# Deployment blueprint source

`../REPAIDO_DEPLOYMENT_BLUEPRINT.pdf` is a nine-page vector diagram of the
checked-in release system. It was generated from the source at commit
`2950b4c3ed25cc41c36606886a26ac69d4a2a541` on 14 October 2026.

Regenerate from the repository root with:

```sh
python3 docs/diagrams/generate_deployment_blueprint.py
```

The generator requires Python packages `reportlab` and `PyYAML`. It reads all
five Cloud Build configurations and `firebase.json`, and fails if their expected
step or route structure differs from the diagram. Review and update the diagram
text when the deployment architecture changes. The public health snapshot on
page 1 is historical (14 October 2026, 01:02 UTC); the generator does not
contact production or deploy anything. Recheck that snapshot before updating
its values. The PDF does not substitute for a live GCP IAM, network, billing,
or resource audit.
