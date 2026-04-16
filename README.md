# 데이터 수집
$env:SEOUL_OPEN_API_KEY="발급받은_서울열린데이터광장_인증키"
npm test
npm run collect:public-data

$env:SGIS_CONSUMER_KEY="발급받은_SGIS_KEY"
$env:SGIS_CONSUMER_SECRET="발급받은_SGIS_SECRET"
npm run geocode:police