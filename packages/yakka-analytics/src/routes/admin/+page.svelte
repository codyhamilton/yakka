<script lang="ts">
	import {
		ApiError,
		fetchAdminStatus,
		fetchMe,
		isCollectorMode,
		startRescore,
		type AdminStatus,
		type AdminTenantStatus
	} from '$lib/api';
	import { formatBytes } from '$lib/format-bytes';
	import { setError } from '$lib/state.svelte';
	import { IdentityPanel } from '$lib/analysis';

	let status = $state<AdminStatus | null>(null);
	let admin = $state<boolean | null>(null);
	let loading = $state(true);
	let note = $state('');
	let starting = $state<string[]>([]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let alive = true;

	const anyRunning = $derived(status?.tenants.some((t) => t.rescore.running) ?? false);

	async function load() {
		try {
			const next = await fetchAdminStatus();
			if (!alive) return;
			status = next;
		} catch (e) {
			if (!alive) return;
			if (e instanceof ApiError && (e.status === 403 || e.status === 401)) admin = false;
			else setError(e);
		} finally {
			if (alive) loading = false;
		}
		if (alive && admin !== false) schedule();
	}

	// Poll quickly while a rescore runs; otherwise leave the page alone.
	function schedule() {
		clearTimeout(timer);
		if (anyRunning) timer = setTimeout(load, 2000);
	}

	$effect(() => {
		alive = true;
		if (!isCollectorMode()) {
			loading = false;
			return () => {
				alive = false;
				clearTimeout(timer);
			};
		}
		void (async () => {
			try {
				const me = await fetchMe();
				if (!alive) return;
				admin = me.admin;
			} catch (e) {
				if (!alive) return;
				setError(e);
				loading = false;
				return;
			}
			if (!alive) return;
			if (admin) await load();
			else loading = false;
		})();
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	});

	function isStarting(id: string): boolean {
		return starting.includes(id);
	}

	async function rescore(t: AdminTenantStatus) {
		if (isStarting(t.id)) return;
		note = '';
		starting = [...starting, t.id];
		try {
			await startRescore(t.id);
			await load();
		} catch (e) {
			if (!alive) return;
			note = e instanceof ApiError ? e.message : 'Could not start the rescore.';
		} finally {
			starting = starting.filter((id) => id !== t.id);
		}
	}

	function unscored(t: AdminTenantStatus): number {
		return t.screens.verdicts?.['unscreened'] ?? 0;
	}

	function when(unix: number): string {
		return unix ? new Date(unix * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '–';
	}

	function used(v: NonNullable<AdminStatus['volume']>): string {
		const pct = v.total_bytes ? Math.round(((v.total_bytes - v.free_bytes) / v.total_bytes) * 100) : 0;
		return `${formatBytes(v.total_bytes - v.free_bytes)} of ${formatBytes(v.total_bytes)} (${pct}%)`;
	}
</script>

<IdentityPanel>
	<h1>Operations</h1>
	<p><a href="/profile">Back to profile</a></p>

	{#if !isCollectorMode()}
		<p>This page needs a signed-in session on the collector.</p>
	{:else if loading}
		<p>Loading…</p>
	{:else if admin === false}
		<p data-testid="admin-forbidden">This page is for the service administrator.</p>
	{:else if status}
		<section>
			<h2>Service</h2>
			<dl data-testid="admin-service">
				<dt>Version</dt>
				<dd>{status.version || 'dev'}</dd>
				{#if status.volume}
					<dt>Data volume</dt>
					<dd data-testid="admin-volume">{used(status.volume)}, {formatBytes(status.volume.free_bytes)} free</dd>
				{/if}
				<dt>Scoring</dt>
				<dd data-testid="admin-scoring">
					{#if !status.scoring.scorer}
						off: set TYPESAFE_API_KEY and YAKKA_CHECKS_DIR and restart
					{:else if !status.scoring.checks}
						screening only: set YAKKA_CHECKS_DIR to score
					{:else}
						on
					{/if}
				</dd>
			</dl>
		</section>

		{#if note}<p role="alert" data-testid="admin-note">{note}</p>{/if}

		{#each status.tenants as t (t.id)}
			<section data-testid="admin-tenant-{t.id}">
				<h2>{t.name || t.id} <small><code>{t.id}</code></small></h2>
				{#if t.error}<p role="alert">Partial status: {t.error}</p>{/if}

				<table>
					<tbody>
						<tr><th>Facts</th><td>{t.facts.toLocaleString()}</td></tr>
						<tr><th>Ledger</th><td>{formatBytes(t.footprint.ledger_bytes)} (+ {formatBytes(t.footprint.wal_bytes)} WAL)</td></tr>
						<tr>
							<th>Archive</th>
							<td data-testid="admin-archive-{t.id}">{formatBytes(t.footprint.archive_bytes)} in {t.footprint.archive_files.toLocaleString()} files</td>
						</tr>
						<tr><th>Blobs</th><td>{formatBytes(t.footprint.blob_bytes)} in {t.footprint.blobs.toLocaleString()} files</td></tr>
						<tr><th>Pending</th><td>{t.footprint.pending.toLocaleString()} files, {formatBytes(t.footprint.pending_bytes)}</td></tr>
						<tr><th>Compaction</th><td>{t.compaction || '–'}</td></tr>
					</tbody>
				</table>

				<h3>Scoring</h3>
				<table>
					<tbody>
						{#each Object.entries(t.screens.verdicts ?? {}) as [verdict, n] (verdict)}
							<tr><th>{verdict}</th><td>{n.toLocaleString()}</td></tr>
						{/each}
						<tr><th>Scored content</th><td>{t.screens.scored_content.toLocaleString()} ({t.screens.score_rows.toLocaleString()} scores)</td></tr>
					</tbody>
				</table>

				<p>
					<button
						type="button"
						data-testid="admin-rescore-{t.id}"
						disabled={!status.scoring.rescorable || t.rescore.running || unscored(t) === 0 || isStarting(t.id)}
						onclick={() => rescore(t)}
					>
						Rescore {unscored(t).toLocaleString()} unscored
					</button>
					{#if t.rescore.running}
						<span role="status" data-testid="admin-rescore-progress-{t.id}">
							Running: {t.rescore.done + t.rescore.failed} of {t.rescore.total}, {t.rescore.failed} failed
						</span>
					{:else if t.rescore.finished}
						<span role="status" data-testid="admin-rescore-progress-{t.id}">
							Last run {when(t.rescore.finished)}: {t.rescore.done} scored, {t.rescore.failed} failed{t.rescore.error
								? `, stopped: ${t.rescore.error}`
								: ''}
						</span>
					{/if}
				</p>

				<h3>Failed scoring</h3>
				{#if t.failures.length === 0}
					<p data-testid="admin-no-failures-{t.id}">None recorded.</p>
				{:else}
					<p>
						Failed content is discarded after repeated errors, so it can only be recovered by sending it again.
					</p>
					<table data-testid="admin-failures-{t.id}">
						<thead><tr><th>When</th><th>Path</th><th>Reason</th></tr></thead>
						<tbody>
							{#each t.failures as f, i (`${f.at}:${f.content_hash}:${i}`)}
								<tr><td>{when(f.at)}</td><td>{f.path || '–'}</td><td>{f.reason}</td></tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>
		{/each}
	{/if}
</IdentityPanel>

<style>
	section {
		margin: 1.5rem 0;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		max-width: 48rem;
	}
	th,
	td {
		border: 1px solid var(--border);
		padding: 0.35rem 0.5rem;
		text-align: left;
	}
</style>
