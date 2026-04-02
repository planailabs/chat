# plan.ai — Architecture

## The Physical Node

A pre-configured Apple Silicon hardware node that sits in your organization's space. It runs quietly, fits on a desk, and becomes your organization's cognitive backbone.

### Three-Layer System

1. **Local Machines**: Your workstations connect to the node on your local network
2. **Governance Layer**: Policy engine that controls data flow, access, and audit trails
3. **Compliant Cloud (Optional)**: When frontier-model reasoning is needed, only sanitized context leaves your perimeter

## Hybrid Intelligence

The system balances local privacy with cloud capability through a three-step process:

1. **Local Perimeter**: Sensitive content is structured, anonymized, and sanitized entirely on-device
2. **Cloud Reasoning**: Only cleaned context reaches external models — no raw data, no identifiable information
3. **Local Integration**: Results return to the node and become part of the organization's private knowledge spine

### What Stays Local by Default
- Client data
- Internal strategy
- Proprietary workflows
- Competitive intelligence

### What Runs on the Node
- Foundation models for low-latency inference
- Autonomous agent orchestration with sandboxed execution
- Persistent organizational memory
- Security architecture (node is off the public internet by default)

## Telemetry

Minimal by design. Diagnostics are opt-in and policy-controlled.
