-- 0011: claim lease + reaper self-heal. A worker that claims a node now stamps WHO holds it
-- (claimed_by), WHEN it was claimed (claimed_at), and WHEN the claim expires (lease_expires_at). A
-- worker heartbeat extends lease_expires_at while its producer is alive; a reaper sweep returns an
-- in-progress node whose lease has lapsed (its owning worker died/restarted) to 'pending', so the
-- loop re-claims it. Before this, an interrupted in-progress node was stranded forever, because
-- claimReadyNode only ever selects status='pending' (see issue 0011).
--
-- All three columns are nullable: existing rows, and any claim taken without a lease, carry NULL
-- (NULL lease_expires_at is never reaped).
ALTER TABLE nodes ADD COLUMN claimed_by       text;
ALTER TABLE nodes ADD COLUMN claimed_at       timestamptz;
ALTER TABLE nodes ADD COLUMN lease_expires_at timestamptz;

-- The reaper filters in-progress rows by lease_expires_at; index the pair so the sweep is a range
-- scan rather than a full scan once the table accumulates historical nodes.
CREATE INDEX idx_nodes_lease ON nodes(status, lease_expires_at);
