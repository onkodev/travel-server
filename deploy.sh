#!/bin/bash
set -e

KEY="$HOME/Downloads/tumakr-prod.pem"
EC2_USER="ec2-user"
EC2_HOST="ec2-54-180-174-37.ap-northeast-2.compute.amazonaws.com"
PM2_NAME="tumakr-api"
SSH="ssh -i $KEY"
RSYNC_SSH="ssh -i $KEY"

echo "=== 1. 빌드 ==="
npm run build

REMOTE_DIR="/home/ec2-user/tumakr-server"

DIST_DIR="$REMOTE_DIR/dist"
BACKUP_DIR="$REMOTE_DIR/dist.backup"

echo "배포 경로: $DIST_DIR"
echo "백업 경로: $BACKUP_DIR"

echo "=== 3. 기존 dist 백업 ==="
$SSH $EC2_USER@$EC2_HOST "
  # 기존 백업이 있으면 제거
  if [ -d '$BACKUP_DIR' ]; then
    echo '기존 백업 제거: $BACKUP_DIR'
    rm -rf '$BACKUP_DIR'
  fi

  # 현재 dist가 있으면 백업으로 이동
  if [ -d '$DIST_DIR' ]; then
    echo '현재 dist → 백업으로 이동'
    mv '$DIST_DIR' '$BACKUP_DIR'
  fi
"

echo "=== 4. 새 dist 업로드 ==="
rsync -avz \
  -e "$RSYNC_SSH" \
  ./dist/ \
  $EC2_USER@$EC2_HOST:$DIST_DIR/

echo "=== 5. PM2 재시작 ==="
$SSH $EC2_USER@$EC2_HOST "cd $REMOTE_DIR && pm2 reload ecosystem.config.js"

echo "=== 배포 완료 ==="
echo "롤백 필요 시: ssh -i $KEY $EC2_USER@$EC2_HOST \"rm -rf $DIST_DIR && mv $BACKUP_DIR $DIST_DIR && pm2 restart $PM2_NAME\""
