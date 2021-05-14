#!/bin/bash

set -e

cd $(dirname $0)

if [[ "$1" == 'local' ]]; then
  docker-compose down

  #docker-compose pull rabbit redis bridge_affirmation deploy-amb
  docker-compose build deploy-omni
  docker-compose build e2e-tests

  docker-compose up -d home foreign

  DATA='{"jsonrpc":2.0,"method":"eth_chainId","params":[],"id":1}'
  until docker-compose run --rm --entrypoint curl deploy-amb curl -d "$DATA" home:8545 >/dev/null 2>&1
  do
    sleep 1
  done
  until docker-compose run --rm --entrypoint curl deploy-amb curl -d "$DATA" foreign:8545 >/dev/null 2>&1
  do
    sleep 1
  done

  docker-compose run --rm deploy-amb
  docker-compose run --rm deploy-omni
  docker-compose up deploy-compound || true

  docker-compose up -d rabbit redis bridge_affirmation bridge_request bridge_collected bridge_senderhome bridge_senderforeign

  docker-compose run --rm e2e-tests
  rc=$?

  docker-compose down
else
  docker-compose -f docker-compose-public.yml build e2e-tests

  docker-compose -f docker-compose-public.yml run --rm e2e-tests
  rc=$?
fi

exit $rc
