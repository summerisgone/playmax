build:
	bun build ./index.ts --compile --outfile build/playmax

clean:
	rm build/playmax
