# Deliverability — must pass before any email is sent

Status: locked · **partly done** · Last updated: 2026-10-26 · Source: kardata_old/campaign/stage0-checklist.md, owner
2026-10-25

**Owner, 2026-10-25:** a sending domain, an inbox and a landing page are set up, and the checks pass. The steps not
yet confirmed are marked `?`.

**Why this comes first:** an earlier campaign got 0 replies from 100 emails, which is the result you get when emails
don't reach the inbox. No list size and no copy fixes that.

## Steps (warm-up takes 14 days, so start first)

| Step | Done |
|---|---|
| Buy 3 lookalike sending domains (e.g. getkardata, kardatahq, trykardata) | ? (at least 1 done) |
| Set up a Google Workspace inbox on each one: real name, photo, plain signature | ? (at least 1 done) |
| SPF, DKIM and DMARC on all 3 (DMARC starts at `p=none`), checked with a header check | [x] passing on the domain set up |
| Point the sending domains at kardata.co, so anyone who searches lands on real content | ? (landing page exists) |
| Warm up for 14+ days with a gradual, human-like volume | ? |
| Inbox test: send the real T1 to 5–10 seed addresses (Gmail, Outlook, Yahoo, one strict Workspace). All must land in the inbox | ? |

**kardata.co never sends cold email.** It hosts the website and case studies only.

## Volume rules (manual sending)

- **Weeks 1–2:** at most 20 per inbox per day. After 2 clean weeks, go up to 30.
- **At peak,** about 70 per day across the 3 inboxes, once follow-ups stack up.
- **Spread sends across the morning** in the recipient's time zone. Never send in bursts.
- **Both buyers at one company** get their email from the same inbox, 2 business days apart.

## Safety

- **Check the tracker before every send.** Manual sending has no automatic stop when someone replies.
- **Read and sort every reply within 12 hours.**
- **A hard bounce** is never retried. Find another buyer, or park the company.

## Pause sending if

- the bounce rate is above 3% in any group of 50;
- there's any spam complaint;
- an inbox test fails;
- there are 0 replies after 100 delivered emails. Check deliverability first, before rewriting the copy.
