1. 목적

이 규약의 목적은 다음 4가지를 동시에 달성하는 것이다.

변경 이력의 가독성
협업 시 충돌 최소화
코드 리뷰 품질 향상
릴리스 자동화 및 운영 안정성 확보
2. 기본 원칙
기본 브랜치는 main 하나를 중심으로 운영한다.
모든 변경은 직접 push 금지, 반드시 PR(Pull Request) 로 반영한다.
feature branch는 짧게 유지하고, 오래 살아있는 브랜치를 금지한다.
main은 항상 배포 가능 상태를 유지한다.
큰 기능은 long-lived branch 대신 feature flag 로 제어한다.
(추정이 아니라 일반 실무 권장 패턴)
3. 브랜치 전략
3.1 영구 브랜치
main
운영 반영 기준 브랜치
항상 배포 가능한 상태 유지
보호 브랜치 적용 필수
3.2 임시 브랜치
feature/<ticket-id>-<short-name>
예: feature/PROJ-142-user-profile-api
bugfix/<ticket-id>-<short-name>
예: bugfix/PROJ-221-login-null-error
hotfix/<ticket-id>-<short-name>
예: hotfix/OPS-19-payment-timeout
release/v<major>.<minor>.<patch>
예: release/v2.4.0
3.3 브랜치 네이밍 규칙
소문자 + 하이픈만 사용
공백, 한글, 특수문자 금지
되도록 이슈 번호 포함
브랜치명만 보고 목적이 드러나야 함
4. 작업 흐름
일반 기능 개발
main 최신화
feature/* 생성
작은 단위로 커밋
PR 생성
리뷰 승인 + CI 통과
Squash Merge 로 main 반영
브랜치 삭제
긴급 장애 수정
main에서 hotfix/* 생성
수정 후 PR
승인 후 즉시 main 반영
배포 후 태그 생성
릴리스 안정화가 필요한 경우
main에서 release/* 생성
문서, 버전, 사소한 버그만 허용
QA 완료 후 main 머지
태그 생성
release branch 삭제
5. 커밋 메시지 규약

Conventional Commits 형식을 사용한다. 기본 구조는 <type>[optional scope]: <description> 이며, breaking change는 ! 또는 footer의 BREAKING CHANGE: 로 표현할 수 있다.

5.1 형식
<type>(<scope>): <subject>

<body>

<footer>
5.2 type 목록
feat: 사용자 기능 추가
fix: 버그 수정
refactor: 동작 변화 없는 구조 개선
perf: 성능 개선
test: 테스트 추가/수정
docs: 문서 수정
build: 빌드 시스템/의존성
ci: CI/CD 설정
chore: 기타 유지보수
style: 포맷팅, 세미콜론 등 비기능 변경
revert: 커밋 되돌림
5.3 scope 규칙

scope는 선택이지만 가능하면 사용한다.

예: api, auth, payment, ui, db, infra
모노레포면 패키지명 사용
예: feat(web): add signup banner
예: fix(api): handle expired token
5.4 subject 규칙
현재형 동사 사용
첫 글자는 소문자
마침표 금지
50자 내외 권장
“무엇을 왜 바꿨는지” 드러나게 작성

좋은 예:

feat(auth): add refresh token rotation
fix(payment): prevent duplicate charge on retry
refactor(user): extract profile mapper

나쁜 예:

fix: bug fix
update code
final commit
5.5 body 규칙

필요할 때만 쓴다.

무엇을 바꿨는지
왜 바꿨는지
어떤 영향이 있는지

예:

fix(payment): prevent duplicate charge on retry

The payment gateway could retry the callback when the network was unstable.
Added idempotency key validation to avoid duplicated billing.
5.6 footer 규칙
이슈 참조: Refs: PROJ-142
종료: Closes: PROJ-142
호환성 파괴:
BREAKING CHANGE: remove legacy login endpoint /v1/login
5.7 breaking change 표기
feat(api)!: remove legacy user schema

또는

feat(api): remove legacy user schema

BREAKING CHANGE: response field `user_name` renamed to `username`
6. PR 규약
6.1 PR 제목

Squash Merge를 쓰므로 PR 제목 자체를 최종 커밋 메시지로 간주한다.

형식:

<type>(<scope>): <subject>

예:

feat(auth): add social login with google
fix(order): correct tax rounding logic
6.2 PR 설명 템플릿
## Summary
- 무엇을 변경했는지

## Why
- 왜 필요한지

## Changes
- 주요 변경 사항

## Impact
- API / DB / UI / Infra 영향 여부

## Test
- 어떻게 검증했는지

## Issue
- PROJ-142
6.3 PR 크기 규칙
1 PR = 1 논리적 목적
리뷰 가능 크기 유지
500라인 초과 시 분리 권장
리팩터링과 기능 추가를 한 PR에 섞지 않는다
7. 머지 정책

GitHub는 merge commit, squash, rebase merge를 지원한다. 이 규약의 기본은 Squash Merge 다. protected branch는 승인 리뷰, status checks, linear history 등을 강제할 수 있다.

기본 정책
기본: Squash Merge
예외:
오픈소스 upstream 이력 보존이 중요하면 Rebase Merge
릴리스 브랜치 병합 이력 자체가 중요하면 제한적으로 Merge Commit
이유
feature branch 내 잡음 제거
main 히스토리를 업무 단위로 유지
revert가 쉬움
changelog 생성이 쉬움
8. 브랜치 보호 규칙

main에 반드시 다음을 적용한다.

direct push 금지
force push 금지
branch deletion 금지
최소 1명 승인, 핵심 모듈은 2명 승인
CI 통과 필수
최신 base branch 반영 필수
conversation resolve 필수
linear history 권장
관리자도 예외 없이 적용 권장

GitHub rulesets/branch protection으로 강제 가능하다.

9. 태그 및 버전 규칙
9.1 태그 형식
v<major>.<minor>.<patch>

예:

v2.3.1
9.2 버전 증가 기준

Conventional Commits는 SemVer와 잘 맞고, semantic-release는 커밋 메시지로 다음 버전을 자동 결정할 수 있다.

fix → patch
feat → minor
BREAKING CHANGE 또는 ! → major

예:

fix(auth): ... → 1.4.2 → 1.4.3
feat(payment): ... → 1.4.2 → 1.5.0
feat(api)!: ... → 1.4.2 → 2.0.0
10. 금지 사항
main에 직접 push
의미 없는 커밋 메시지
fix
update
final
asdf
서로 다른 목적의 변경을 한 커밋에 혼합
PR 하나에 기능 추가 + 리팩터링 + 포맷팅 대량 변경 섞기
오래 살아있는 feature branch 방치
리뷰 없이 긴급 머지
force push로 공유 이력 덮어쓰기
11. 예외 규칙

아래 상황은 예외 허용 가능:

아주 작은 typo/docs 수정
배포 장애 대응 hotfix
운영 로그 레벨 조정 같은 저위험 변경

단, 예외라도:

PR 기록은 남긴다
이유를 설명한다
사후 회고나 follow-up issue를 남긴다
12. 권장 자동화
commitlint: 커밋 메시지 검사
semantic-release: 버전/릴리스 노트 자동화
GitHub Actions:
PR title lint
test/build/lint
branch naming check
release tagging