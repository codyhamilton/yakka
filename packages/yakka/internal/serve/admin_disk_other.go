//go:build !unix

package serve

import "errors"

func volumeUsage(string) (total, free uint64, err error) {
	return 0, 0, errors.New("volume usage is not available on this platform")
}
