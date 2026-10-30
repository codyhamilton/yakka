import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
	it('scales through binary units', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1023)).toBe('1023 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1.13 * 1024 ** 3)).toBe('1.1 GB');
	});
	it('rejects nonsense', () => {
		expect(formatBytes(-1)).toBe('–');
		expect(formatBytes(NaN)).toBe('–');
	});
});
