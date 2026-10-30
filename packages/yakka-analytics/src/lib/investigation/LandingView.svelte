<script lang="ts">
	import { goto } from '$app/navigation';
	import { aggregate } from '$lib/aggregate';
	import { TrendChart, type TrendFrameData } from '$lib/analysis/chart-frame';
	import { isCollectorMode } from '$lib/api';
	import { tenantIdFromMe } from '$lib/session-gate';
	import { sessionGate } from '$lib/session-gate.svelte';
	import { Superseded } from '$lib/query';
	import { clearError, setError } from '$lib/state.svelte';
	import { trendFrame } from './frames';
	import { investigationRequestToSearch } from './request-url';

	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const sessionTenant = $derived(isCollectorMode() ? tenantIdFromMe(sessionGate.me, sessionGate.tenant) : null);
	const sessionReady = $derived(sessionGate.ready);

	let hookEvents = $state<TrendFrameData | null>(null);
	let costUsd = $state<TrendFrameData | null>(null);

	function openInvestigation() {
		const req = {
			...(sessionTenant ? { tenant: sessionTenant } : {}),
			window: { preset: '30d', tz },
			ask: { ask: 'trend' as const, measure: 'hook_events', bucket: 'day' as const }
		};
		const qs = investigationRequestToSearch(req).toString();
		goto(`/?${qs}`, { noScroll: true });
	}

	$effect(() => {
		if (!sessionReady) return;

		let live = true;
		const fail = (e: unknown) => {
			if (!live || e instanceof Superseded) return;
			setError(e);
		};

		const tenant = sessionTenant;
		const base = tenant
			? { tenant, window: { preset: '30d' as const, tz } }
			: { window: { preset: '30d' as const, tz } };

		(async () => {
			const now = new Date();
			try {
				const hook = await aggregate(
					{
						...base,
						ask: { ask: 'trend', measure: 'hook_events', bucket: 'day' }
					},
					{ now }
				);
				if (!live) return;
				clearError();
				hookEvents = hook.ask === 'trend' ? trendFrame('hook_events', 'day', hook, undefined, tz) : null;

				const cost = await aggregate(
					{
						...base,
						ask: { ask: 'trend', measure: 'cost_usd', bucket: 'day' }
					},
					{ now }
				);
				if (!live) return;
				clearError();
				costUsd = cost.ask === 'trend' ? trendFrame('cost_usd', 'day', cost, undefined, tz) : null;
			} catch (e) {
				fail(e);
			}
		})();

		return () => {
			live = false;
		};
	});
</script>

<h1>Overview</h1>

<button type="button" class="investigate" data-testid="landing-open-investigation" onclick={openInvestigation}>
	Open analysis
</button>

{#if hookEvents}
	<section class="trend">
		<span class="label">{hookEvents.measure}</span>
		<TrendChart data={hookEvents} testid="landing-trend-hook_events" />
	</section>
{/if}
{#if costUsd}
	<section class="trend">
		<span class="label">{costUsd.measure}</span>
		<TrendChart data={costUsd} testid="landing-trend-cost_usd" />
	</section>
{/if}

<style>
	.investigate {
		margin: 0.75rem 0 0;
	}
	.trend {
		margin-top: 1rem;
	}
	.label {
		display: block;
		font-size: 0.85rem;
		color: var(--muted);
		margin-bottom: 0.35rem;
	}
</style>
