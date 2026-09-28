# Agents gates

Deterministic submit gate chain, tripwire, advisory rubric, pre-flight
checks (T6.1-T6.2).

## Gate chain (T6.1)

`runGateChain` runs four predicates in order: todos complete, submission
shape, budgets clear, parent submitter scope. Failures return error strings;
`task.submit` records nothing until the chain is silent. Children report
through `collect_result`, never `task.submit`: a child submit is a delegation
escape and always fails the scope check.

## Tripwire (T6.1)

`assertNoTripwire` throws `TripwireError` (never a retryable error) on empty
results and submit-while-blocked. Violations halt; they do not resume.

## Rubric (T6.1)

`runRubric` grades with an injected grader until satisfied, failed, or the
iteration cap, which terminates as failed with the last response intact.
Advisory only: the deterministic chain still decides submission.

## Pre-flight (T6.2)

`runPreflight` checks token headroom, required-tool reachability, duplicate
runs, and policy version before long operations. Any failure blocks with
reasons. Success issues a receipt with a frozen brief hash (`freezeBrief` is
sha256 over the scope). Long operations start only with a receipt.
