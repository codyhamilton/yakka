<script lang="ts">
	import {
		ApiError,
		createTenant,
		createToken,
		DEFAULT_TOKEN_LIFETIME,
		fetchMe,
		isCollectorMode,
		listAdminTokens,
		listTokens,
		revokeToken,
		TOKEN_LIFETIMES,
		type AdminTokenListItem,
		type CreatedTokenResponse,
		type MeResponse,
		type TokenLifetime,
		type TokenListItem
	} from '$lib/api';
	import { setError } from '$lib/state.svelte';
	import { IdentityPanel } from '$lib/analysis';
	import { initialTenantChoice, readRememberedTenant, showsTenantChoice } from '$lib/session-gate';

	let me = $state<MeResponse | null>(null);
	let tokens = $state<TokenListItem[]>([]);
	let adminTokens = $state<AdminTokenListItem[]>([]);
	let loading = $state(true);

	let tenantName = $state('');
	let tokenTenant = $state('');
	let tokenScope = $state<'read' | 'read_write'>('read_write');
	let tokenLifetime = $state<TokenLifetime>(DEFAULT_TOKEN_LIFETIME);
	let tokenName = $state('');
	let createdPlaintext = $state<CreatedTokenResponse | null>(null);

	let tenantStatus = $state('');
	let tokenStatus = $state('');

	async function reload() {
		loading = true;
		try {
			const m = await fetchMe();
			me = m;
			tokenTenant = initialTenantChoice(m.tenants, tokenTenant, readRememberedTenant());
			tokens = await listTokens();
			adminTokens = m.admin ? await listAdminTokens() : [];
		} catch (e) {
			setError(e);
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

	async function submitTenant(e: Event) {
		e.preventDefault();
		tenantStatus = '';
		try {
			const { id, name } = await createTenant(tenantName.trim());
			tenantStatus = `Created tenant ${name}.`;
			tenantName = '';
			await reload();
			tokenTenant = id;
		} catch (err) {
			tenantStatus = err instanceof ApiError ? err.message : 'Could not create tenant.';
		}
	}

	async function submitToken(e: Event) {
		e.preventDefault();
		tokenStatus = '';
		createdPlaintext = null;
		try {
			const created = await createToken({
				tenant: tokenTenant,
				scope: tokenScope,
				lifetime: tokenLifetime,
				name: tokenName.trim() || undefined
			});
			createdPlaintext = created;
			tokenStatus = 'Token created. Copy it now; it will not be shown again.';
			await reload();
		} catch (err) {
			tokenStatus = err instanceof ApiError ? err.message : 'Could not create token.';
		}
	}

	async function doRevoke(id: string) {
		try {
			await revokeToken(id);
			if (createdPlaintext?.id === id) createdPlaintext = null;
			await reload();
		} catch (err) {
			setError(err);
		}
	}

	async function copyPlaintext() {
		if (!createdPlaintext?.token) return;
		try {
			await navigator.clipboard.writeText(createdPlaintext.token);
			tokenStatus = 'Copied to clipboard.';
		} catch {
			tokenStatus = 'Could not copy; select the token text manually.';
		}
	}
</script>

<IdentityPanel>
	<h1>Profile</h1>

	{#if !isCollectorMode()}
	<p>
		This page needs a signed-in session on the collector (this site, or API base
		<code>https://api.yakka.build</code> in <a href="/settings">/settings</a>).
	</p>
{:else if loading}
	<p>Loading…</p>
{:else if me}
	<p>Signed in as <strong>{me.github_login}</strong> (GitHub id {me.github_id}).</p>

	<section>
		<h2>Create tenant</h2>
		<form onsubmit={submitTenant}>
			<label>
				Tenant name
				<input data-testid="profile-tenant-name" bind:value={tenantName} required autocomplete="off" />
			</label>
			<button type="submit" data-testid="profile-tenant-submit">Create tenant</button>
			<span role="status">{tenantStatus}</span>
		</form>
	</section>

	<section>
		<h2>Create token</h2>
		<form onsubmit={submitToken}>
			{#if showsTenantChoice(me.tenants)}
				<label>
					Tenant
					<select data-testid="profile-token-tenant" bind:value={tokenTenant} required>
						<option value="" disabled>Select tenant</option>
						{#each me.tenants as t (t.id)}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<label>
				Scope
				<select data-testid="profile-token-scope" bind:value={tokenScope}>
					<option value="read">read</option>
					<option value="read_write">read_write</option>
				</select>
			</label>
			<label>
				Expires in
				<select data-testid="profile-token-lifetime" bind:value={tokenLifetime}>
					{#each TOKEN_LIFETIMES as l (l.value)}
						<option value={l.value}>{l.label}</option>
					{/each}
				</select>
			</label>
			<label>
				Name
				<input
					data-testid="profile-token-name"
					bind:value={tokenName}
					maxlength="64"
					autocomplete="off"
					placeholder="e.g. work laptop"
				/>
			</label>
			<button type="submit" data-testid="profile-token-submit" disabled={!tokenTenant}>Create token</button>
			<span role="status">{tokenStatus}</span>
		</form>
		{#if createdPlaintext}
			<div class="plaintext" data-testid="profile-token-plaintext">
				<p>New token (shown once):</p>
				<code>{createdPlaintext.token}</code>
				<button type="button" data-testid="profile-token-copy" onclick={copyPlaintext}>Copy</button>
			</div>
		{/if}
	</section>

	<section>
		<h2>Your tokens</h2>
		{#if tokens.length === 0}
			<p>No tokens yet.</p>
		{:else}
			<table data-testid="profile-token-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Tenant</th>
						<th>Scope</th>
						<th>Expires</th>
						<th>Revoked</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each tokens as row (row.id)}
						<tr>
							<td>{row.name || '(unnamed)'}</td>
							<td>{row.tenant_name}</td>
							<td>{row.scope}</td>
							<td>{row.expires_at}</td>
							<td>{row.revoked ? 'yes' : 'no'}</td>
							<td>
								{#if !row.revoked}
									<button type="button" data-testid="profile-revoke-{row.id}" onclick={() => doRevoke(row.id)}>
										Revoke
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	{#if me.admin}
		<section>
			<h2>All tokens (admin)</h2>
			<table data-testid="profile-admin-token-table">
				<thead>
					<tr>
						<th>GitHub id</th>
						<th>Name</th>
						<th>Tenant</th>
						<th>Scope</th>
						<th>Expires</th>
						<th>Revoked</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each adminTokens as row (row.id)}
						<tr>
							<td>{row.github_id}</td>
							<td>{row.name || '(unnamed)'}</td>
							<td>{row.tenant_name}</td>
							<td>{row.scope}</td>
							<td>{row.expires_at}</td>
							<td>{row.revoked ? 'yes' : 'no'}</td>
							<td>
								{#if !row.revoked}
									<button type="button" data-testid="profile-admin-revoke-{row.id}" onclick={() => doRevoke(row.id)}>
										Revoke
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
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
	.plaintext {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--border);
		background: var(--surface);
	}
	.plaintext code {
		display: block;
		margin: 0.5rem 0;
		word-break: break-all;
	}
</style>
