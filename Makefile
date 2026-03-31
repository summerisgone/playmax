build:
	bun build ./index.ts --compile --outfile build/playmax --external chromium-bidi \
--external electron

clean:
	rm -rf  build
