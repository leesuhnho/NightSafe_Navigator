# Batch Flow

## 현재 배치 흐름

1. `scripts/ingestion/run.mjs` 가 공식 원천을 받아 `data/raw/<source>/<runId>/` 에 그대로 저장한다.
2. `scripts/refinement/run.mjs` 가 각 source 의 최신 usable raw 실행본을 골라 `data/processed/<source>/<runId>/` 로 정제한다.
3. 정제 결과는 `records.json` 과 `manifest.json` 으로 남기고, raw 원본 경로와 정제 통계를 같이 기록한다.

## 왜 raw 와 processed 를 분리하나

- raw 는 원본 보존과 재현성 확보가 목적이다.
- processed 는 서비스 코드, 분석, 후속 DB 적재가 바로 읽기 쉬운 형태가 목적이다.
- 정제 규칙이 바뀌어도 raw 를 다시 받지 않고 processed 만 재생성할 수 있다.

## 현재 지원 정제기

- `bus-stop`
  - 입력: 최신 raw 버스정류소 XLSX
  - 출력: 정류소 ID, ARS-ID, 이름, 좌표, 정류소 타입
- `police-patrol-box`
  - 입력: 최신 raw 지구대/파출소 CSV
  - 출력: 서울 지역 경찰시설 이름, 유형, 주소

## 실행 예시

```bash
node scripts/refinement/run.mjs list
node scripts/refinement/run.mjs refine all
node scripts/refinement/run.mjs refine bus-stop police-patrol-box
```
