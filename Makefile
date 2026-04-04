DOCKER_IMAGE ?= playmax:latest
DOCKER_PLATFORM ?=

build:
	bun build ./index.ts --compile --outfile build/playmax --external chromium-bidi \
--external electron

clean:
	rm -rf  build

docker-build:
	docker build $(if $(DOCKER_PLATFORM),--platform $(DOCKER_PLATFORM),) -t $(DOCKER_IMAGE) .

docker-sync: docker-build
	docker run --rm --init \
		--env-file $(CURDIR)/.env \
		-e PLAYMAX_STATE_DIR=/state \
		-v $(CURDIR)/.env:/app/.env:ro \
		-v $(CURDIR):/state \
		$(DOCKER_IMAGE) bun run sync

docker-analyze: docker-build
	docker run --rm --init \
		--env-file $(CURDIR)/.env \
		-e PLAYMAX_STATE_DIR=/state \
		-v $(CURDIR)/.env:/app/.env:ro \
		-v $(CURDIR):/state \
		$(DOCKER_IMAGE) bun run analyze
