<script lang="ts">
	import '$lib/analysis/tokens.css';
	import '$lib/theme.css';
	import RouteSurface from '$lib/analysis/RouteSurface.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		getThemePreference,
		initTheme,
		setThemePreference,
		type ThemePreference
	} from '$lib/charts/theme';
	import Notices from '$lib/components/Notices.svelte';
	import { ApiError, fetchMe, isCollectorMode, safeReturnPath } from '$lib/api';
	import {
		decideAfterMeFetch,
		readBearer,
		readConfiguredBase,
		routeAllowsChildren,
		shouldNavigateToProfile,
		showsTenantChoice,
		tenantIdFromMe,
		tenantsFromMe,
		type MeFetchResult
	} from '$lib/session-gate';
	import {
		beginSessionGate,
		chooseTenant,
		finishSessionGate,
		sessionGate
	} from '$lib/session-gate.svelte';
	import { isInvestigationQuery } from '$lib/investigation/request-url';
	import { clearError, fetchError, pruneNotices, setNoticeView } from '$lib/state.svelte';

	let { children } = $props();

	const nav = [
		['/', 'Overview'],
		['/profile', 'Profile'],
		['/settings', 'Settings']
	];

	const chrome = $derived(
		page.url.pathname !== '/settings' &&
			page.url.pathname !== '/login' &&
			page.url.pathname !== '/profile' &&
			page.url.pathname !== '/admin' &&
			page.url.pathname !== '/device' &&
			!page.url.pathname.startsWith('/oauth/')
	);

	const collector = $derived(isCollectorMode());
	const tenants = $derived(tenantsFromMe(sessionGate.me));
	const currentTenant = $derived(tenantIdFromMe(sessionGate.me, sessionGate.tenant) ?? '');
	const noTenant = $derived(collector && fetchError.status === 403 && fetchError.message === 'no such tenant');

	function navHref(path: string): string {
		return path;
	}

	function navCurrent(path: string): 'page' | undefined {
		if (page.url.pathname !== path) return undefined;
		if (path === '/' && isInvestigationQuery(page.url.searchParams)) return undefined;
		return 'page';
	}

	const viewKey = $derived(page.url.pathname + page.url.search);
	$effect.pre(() => setNoticeView(viewKey));

	$effect(() => {
		page.url.pathname;
		page.url.search;
		clearError();
		pruneNotices();
	});

	function gateDecisionForCurrentUrl(me: MeFetchResult): ReturnType<typeof decideAfterMeFetch> {
		return decideAfterMeFetch({
			hostname: location.hostname,
			pathname: page.url.pathname,
			search: page.url.search,
			configuredBase: readConfiguredBase(),
			bearer: readBearer(),
			me
		});
	}

	const sessionAllowsChildren = $derived.by(() => {
		const ready = sessionGate.ready && sessionGate.me !== null;
		const decision = ready ? gateDecisionForCurrentUrl(sessionGate.me as MeFetchResult) : null;
		return routeAllowsChildren(page.url.pathname, ready, decision);
	});

	$effect(() => {
		let live = true;
		beginSessionGate();

		void (async () => {
			let me: MeFetchResult;
			try {
				const body = await fetchMe();
				me = { kind: 'ok', body };
			} catch (e) {
				if (e instanceof ApiError) {
					me = { kind: 'http', status: e.status, message: e.message };
				} else {
					me = { kind: 'other' };
				}
			}
			if (!live) return;
			finishSessionGate(me);
		})();

		return () => {
			live = false;
		};
	});

	$effect(() => {
		page.url.pathname;
		if (!sessionGate.ready || sessionGate.me === null) return;

		const decision = gateDecisionForCurrentUrl(sessionGate.me);
		if (decision !== 'stay') {
			const ret = encodeURIComponent(safeReturnPath(decision.login) ?? '/');
			void goto(`/login?return=${ret}`);
		}
	});

	$effect(() => {
		if (!sessionGate.ready || !sessionGate.me) return;
		if (
			shouldNavigateToProfile({
				pathname: page.url.pathname,
				me: sessionGate.me,
				fetchErrorStatus: fetchError.status,
				fetchErrorMessage: fetchError.message
			})
		) {
			void goto('/profile');
		}
	});

	let themePref = $state<ThemePreference>('system');
	$effect(() => {
		const off = initTheme();
		themePref = getThemePreference();
		return off;
	});

	function chooseTheme(pref: ThemePreference) {
		setThemePreference(pref);
		themePref = pref;
	}
</script>

<svelte:head>
	<script>
		(function () {
			var key = 'yakka-analytics-theme';
			var pref = 'system';
			try {
				var v = localStorage.getItem(key);
				if (v === 'light' || v === 'dark' || v === 'system') pref = v;
			} catch (e) {}
			var dark =
				pref === 'dark' ||
				(pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
			document.documentElement.dataset.theme = dark ? 'dark' : 'light';
		})();
	</script>
</svelte:head>

<header>
		<strong>Workflow analytics</strong>
		<div class="theme" role="group" aria-label="Theme">
			<button
				type="button"
				data-testid="theme-system"
				aria-pressed={themePref === 'system'}
				onclick={() => chooseTheme('system')}>System</button
			>
			<button
				type="button"
				data-testid="theme-light"
				aria-pressed={themePref === 'light'}
				onclick={() => chooseTheme('light')}>Light</button
			>
			<button
				type="button"
				data-testid="theme-dark"
				aria-pressed={themePref === 'dark'}
				onclick={() => chooseTheme('dark')}>Dark</button
			>
		</div>
		{#if collector && showsTenantChoice(tenants)}
			<label class="tenant">
				Tenant
				<select
					data-testid="tenant-switcher"
					value={currentTenant}
					onchange={(e) => chooseTenant(e.currentTarget.value)}
				>
					{#each tenants as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<nav>
			{#each nav as [href, text] (href)}
				<a href={navHref(href)} aria-current={navCurrent(href)}>{text}</a>
			{/each}
		</nav>
	</header>

	<main>
		{#if chrome}
			<RouteSurface>
				<Notices />
				{#if fetchError.message}
					<div class="error" role="alert" data-testid="error-panel">
						<p>{fetchError.message}{fetchError.status ? ` (HTTP ${fetchError.status})` : ''}</p>
						{#if noTenant}
							<p>You do not have a tenant yet. <a href="/profile">Create one on your profile</a>.</p>
						{:else if fetchError.status === 401 || fetchError.network}
							<p>Check the connection in <a href="/settings">/settings</a>: the API base URL and the token.</p>
						{/if}
					</div>
				{/if}
				{#if sessionAllowsChildren}
					{@render children()}
				{/if}
			</RouteSurface>
		{:else}
			{#if fetchError.message}
				<div class="error" role="alert" data-testid="error-panel">
					<p>{fetchError.message}{fetchError.status ? ` (HTTP ${fetchError.status})` : ''}</p>
					{#if noTenant}
						<p>You do not have a tenant yet. <a href="/profile">Create one on your profile</a>.</p>
					{:else if fetchError.status === 401 || fetchError.network}
						<p>Check the connection in <a href="/settings">/settings</a>: the API base URL and the token.</p>
					{/if}
				</div>
			{/if}
			{#if sessionAllowsChildren}
				{@render children()}
			{/if}
		{/if}
	</main>

<style>
	:global(body) {
		margin: 0;
		overflow-x: hidden;
		font-family: system-ui, sans-serif;
		color: var(--text);
		background: var(--bg);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-4);
		align-items: baseline;
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.theme {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.tenant {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
	}
	.tenant select {
		font: inherit;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
		padding: var(--space-1) var(--space-2);
	}
	.theme button {
		font: inherit;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
	.theme button[aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
	}
	nav a {
		color: var(--text);
		text-decoration: none;
	}
	nav a[aria-current='page'] {
		font-weight: 700;
		color: var(--accent);
	}
	main {
		padding: 0 var(--space-4) var(--space-5);
		overflow-x: hidden;
	}
	.error {
		margin: var(--space-3) 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--danger);
		background: var(--surface);
		color: var(--text);
	}
	.error p {
		margin: 0.25rem 0;
	}
</style>
