#!/bin/bash
apt update
apt-get install -y gettext-base sudo wget

set -e
#set -x

# Check if all variables used in the templates are defined or not
for template in /data/homeserver.template.yaml /data/appservice-universe-bots.template.yaml
do
    grep -o '\${[0-9A-Za-z_]*}' "$template" | while read line
    do
        line=$(echo "$line" | sed 's/^..//' | sed 's/.$//')
        if [[ -z `printenv $line` ]]; then
          echo "---------------------------------------------"
          echo "------------------- ERROR -------------------"
          echo "Environment variable $line key is not defined"
          echo "---------------------------------------------"
          exit 1
        fi
    done
done

envsubst < /data/homeserver.template.yaml > /data/homeserver.yaml
# The bot server (docker-compose.bots.yaml) is an application service: Synapse reads this file to know which
# accounts (@bot_*) the bot server owns and how to reach it. See docs/others/contributing/matrix-dev.md
envsubst < /data/appservice-universe-bots.template.yaml > /data/appservice-universe-bots.yaml

# Wait for the OIDC mock server to be up, exit with an error after 2 minutes
timeout=120
elapsed=0
echo "Waiting for OIDC mock server to be up..."
while ! wget -q http://oidc.workadventure.localhost/.well-known/openid-configuration; do
    if [ $elapsed -ge $timeout ]; then
        echo "Error: OIDC mock server did not start within 2 minutes."
        exit 1
    fi
    echo "Waiting for OIDC mock server to be up..."
    sleep 1
    elapsed=$((elapsed + 1))
done
echo "OIDC mock server is up."

python -m synapse.app.homeserver \
    --config-path /data/homeserver.yaml \
    --generate-config \
    --report-stats=yes
sudo chmod -R 777 /data

sleep 10 && register_new_matrix_user -c /data/homeserver.yaml -u ${MATRIX_ADMIN_USER} -p ${MATRIX_ADMIN_PASSWORD} -a &
exec "/start.py"