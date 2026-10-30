<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		ApiError,
		approveDevice,
		createTenant,
		denyDevice,
		fetchMe,
		isCollectorMode,
		oauthLoginPath,
		safeReturnPath,
		type MeResponse
	} from '$lib/api';
	import { initialTenantChoice, readRememberedTenant, showsTenantChoice } from '$lib/session-gate';
	import { IdentityPanel } from '$lib/analysis';

	const userCode = $derived((page.url.searchParams.get('user_code') ?? '').trim().toUpperCase());
	const oauthReturn = $derived(safeReturnPath(page.url.pathname + page.url.search) ?? '');
	const loginHref = $derived(oauthLoginPath(page.url.hostname, oauthReturn));

	let me = $state<MeResponse | null>(null);
	let loading = $state(true);
	let needsSignIn = $state(false);

	let tenantName = $state('');
	let selectedTenant = $state('');
	let grantScope = $state<'' | 'read' | 'read_write'>('');
	let expiresLocal = $state('');

	let tenantStatus = $state('');
	let entryCode = $state('');
	let codeError = $state('');
	let result = $state('');
	let busy = $state(false);
	const decided = $derived(result === 'Approved — return to your terminal' || result === 'Denied');

	function parseFutureExpiry(local: string): string | null {
		if (!local.trim()) return null;
		const d = new Date(local);
		if (Number.isNaN(d.getTime())) return null;
		const iso = d.toISOString();
		if (d.getTime() <= Date.now()) return null;
		return iso;
	}

	const expiresAt = $derived(parseFutureExpiry(expiresLocal));

	const canApprove = $derived(
		userCode !== '' &&
			me !== null &&
			selectedTenant !== '' &&
			grantScope !== '' &&
			expiresAt !== null &&
			!busy &&
			!decided
	);
	const canDeny = $derived(userCode !== '' && !busy && !decided);

	async function reload() {
		loading = true;
		needsSignIn = false;
		try {
			me = await fetchMe();
			selectedTenant = initialTenantChoice(me.tenants, selectedTenant, readRememberedTenant());
		} catch (e) {
			me = null;
			if (e instanceof ApiError && e.status === 401) {
				needsSignIn = true;
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!isCollectorMode()) {
			loading = false;
			return;
		}
		void reload();
	});

	function describeError(err: unknown): string {
		if (err instanceof ApiError) {
			if (err.status === 404) return 'That code is unknown or has expired. Run `yakka login` again.';
			if (err.status === 403) return 'You do not own that tenant.';
			if (err.status === 429) return 'Too many attempts. Wait and try again.';
			return err.message;
		}
		return err instanceof Error ? err.message : 'Request failed.';
	}

	async function decide(run: () => Promise<unknown>, done: string) {
		busy = true;
		codeError = '';
		result = '';
		try {
			await run();
			result = done;
		} catch (err) {
			codeError = describeError(err);
		} finally {
			busy = false;
		}
	}

	function approve() {
		if (!canApprove || expiresAt === null) return;
		void decide(
			() =>
				approveDevice({
					user_code: userCode,
					tenant: selectedTenant,
					scope: grantScope,
					expires_at: expiresAt
				}),
			'Approved — return to your terminal'
		);
	}

	function deny() {
		if (!canDeny) return;
		void decide(() => denyDevice(userCode), 'Denied');
	}

	function submitEntry(e: Event) {
		e.preventDefault();
		const code = entryCode.trim().toUpperCase();
		if (!code) return;
		void goto(`?user_code=${encodeURIComponent(code)}`, { keepFocus: true });
	}

	async function submitTenant(e: Event) {
		e.preventDefault();
		tenantStatus = '';
		try {
			const { id, name } = await createTenant(tenantName.trim());
			tenantStatus = `Created tenant ${name}.`;
			tenantName = '';
			await reload();
			selectedTenant = id;
		} catch (err) {
			tenantStatus = err instanceof ApiError ? err.message : 'Could not create tenant.';
		}
	}
</script>

<IdentityPanel>
	<h1>Authorize yakka CLI</h1>

	{#if !isCollectorMode()}
	<p>This page needs the collector (this site, or API base <code>https://api.yakka.build</code>).</p>
{:else if loading}
	<p>Loading…</p>
{:else if needsSignIn}
	<p>Sign in to continue authorizing this device.</p>
	<p>
		<a href={loginHref} data-testid="device-oauth-login">
			Sign in with GitHub
		</a>
	</p>
{:else if me}
	<p>Signed in as <strong>{me.github_login}</strong>.</p>

	{#if userCode === ''}
		<form onsubmit={submitEntry}>
			<label>
				Code from your terminal
				<input
					data-testid="device-user-code"
					bind:value={entryCode}
					required
					autocomplete="off"
					autocapitalize="characters"
				/>
			</label>
			<button type="submit" data-testid="device-code-submit">Continue</button>
		</form>
	{:else}
		<p>Check this matches the code in your terminal:</p>
		<p class="code" data-testid="device-user-code">{userCode}</p>

		<section>
			<h2>Tenant</h2>
			{#if me.tenants.length === 0}
				<p>You do not have a tenant yet. Create one to issue a token.</p>
				<form onsubmit={submitTenant}>
					<label>
						Tenant name
						<input data-testid="device-tenant-name" bind:value={tenantName} required autocomplete="off" />
					</label>
					<button type="submit" data-testid="device-tenant-submit">Create tenant</button>
					<span role="status">{tenantStatus}</span>
				</form>
			{:else}
				<form
					id="device-form"
					onsubmit={(e) => {
						e.preventDefault();
						approve();
					}}
					data-testid="device-authorize-form"
				>
					{#if showsTenantChoice(me.tenants)}
						<label>
							Tenant
							<select data-testid="device-tenant" bind:value={selectedTenant} required>
								<option value="" disabled selected>Select tenant</option>
								{#each me.tenants as t (t.id)}
									<option value={t.id}>{t.name}</option>
								{/each}
							</select>
						</label>
					{/if}

					<label>
						Grant
						<select data-testid="device-grant" bind:value={grantScope} required>
							<option value="" disabled selected>Select grant</option>
							<option value="read">read</option>
							<option value="read_write">read_write</option>
						</select>
					</label>

					<label>
						Expires (UTC)
						<input data-testid="device-expires" type="datetime-local" bind:value={expiresLocal} required />
					</label>

					<div class="actions">
						<button type="submit" data-testid="device-submit" disabled={!canApprove}>Approve</button>
						<button type="button" data-testid="device-deny" disabled={!canDeny} onclick={deny}>Deny</button>
					</div>
				</form>
			{/if}
		</section>

		{#if me.tenants.length === 0}
			<p>
				<button type="button" data-testid="device-deny" disabled={!canDeny} onclick={deny}>Deny</button>
			</p>
		{/if}

		<p role="status" data-testid="device-result">{result}</p>
		{#if codeError}
			<p class="warn" role="alert" data-testid="device-code-error">{codeError}</p>
		{/if}
	{/if}
{/if}
</IdentityPanel>

<style>
	section {
		margin: 1.5rem 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 28rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
	}
	.code {
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		font-family: monospace;
	}
	.warn {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--danger);
		background: var(--surface);
		color: var(--text);
	}
</style>
