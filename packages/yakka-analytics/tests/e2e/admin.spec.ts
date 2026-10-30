import { expect, test } from '@playwright/test';

const tenant = {
	id: 't-ops',
	name: 'ops',
	facts: 1234,
	compaction: 'done',
	footprint: {
		ledger_bytes: 2 * 1024 ** 3,
		wal_bytes: 0,
		archive_bytes: 1.5 * 1024 ** 3,
		archive_files: 7413,
		blob_bytes: 1024,
		blobs: 3,
		pending_bytes: 0,
		pending: 0,
		other_bytes: 0
	},
	screens: { verdicts: { unscreened: 5, pass: 2 }, scored_content: 2, score_rows: 9, rejections: null, total_rejections: 0 },
	failures: [{ stage: 'screen', pattern: 'screen_error', reason: 'screen error: boom', path: 'docs/x.md', content_hash: 'a', at: 1700000000 }],
	rescore: { running: false, total: 0, done: 0, failed: 0, started: 0, finished: 0 }
};

function status(running: boolean) {
	return {
		version: 'v1',
		scoring: { scorer: true, checks: true, rescorable: true },
		volume: { total_bytes: 10 * 1024 ** 3, free_bytes: 4 * 1024 ** 3 },
		tenants: [{ ...tenant, rescore: { ...tenant.rescore, running, total: running ? 5 : 0 } }]
	};
}

test('admin sees disk use, failures and can start a rescore', async ({ page }) => {
	await page.route('**/v1/me', (route) =>
		route.fulfill({ json: { github_id: 1, github_login: 'a', admin: true, tenants: [{ id: 't-ops', name: 'ops' }] } })
	);
	let started = false;
	await page.route('**/v1/admin/status', (route) => route.fulfill({ json: status(started) }));
	await page.route('**/v1/admin/rescore', (route) => {
		started = true;
		route.fulfill({ status: 202, json: { running: true, total: 5, done: 0, failed: 0, started: 1, finished: 0 } });
	});
	await page.goto('/admin');
	await expect(page.getByTestId('admin-volume')).toContainText('6.0 GB of 10.0 GB (60%)');
	await expect(page.getByTestId('admin-archive-t-ops')).toContainText('1.5 GB in 7,413 files');
	await expect(page.getByTestId('admin-failures-t-ops')).toContainText('screen error: boom');
	const button = page.getByTestId('admin-rescore-t-ops');
	await expect(button).toBeEnabled();
	await button.click();
	await expect(page.getByTestId('admin-rescore-progress-t-ops')).toContainText('Running: 0 of 5');
	await expect(button).toBeDisabled();
});

test('non-admin sees no operations', async ({ page }) => {
	await page.route('**/v1/me', (route) =>
		route.fulfill({ json: { github_id: 2, github_login: 'b', admin: false, tenants: [{ id: 't', name: 't' }] } })
	);
	await page.route('**/v1/admin/status', (route) => route.fulfill({ status: 403, json: { error: 'forbidden' } }));
	await page.goto('/admin');
	await expect(page.getByTestId('admin-forbidden')).toBeVisible();
});
