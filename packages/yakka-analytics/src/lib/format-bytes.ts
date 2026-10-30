const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 -> "1.5 KB". Binary units, one decimal above bytes. */
export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n < 0) return '–';
	let v = n;
	let i = 0;
	while (v >= 1024 && i < UNITS.length - 1) {
		v /= 1024;
		i++;
	}
	return i === 0 ? `${v} B` : `${v.toFixed(1)} ${UNITS[i]}`;
}
