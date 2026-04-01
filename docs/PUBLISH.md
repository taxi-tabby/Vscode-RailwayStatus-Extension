# VS Code Marketplace 배포 가이드

> Microsoft Azure DevOps Organization 생성 버그로 PAT 발급이 불가능한 경우의 우회 방법

## 사전 준비

```bash
npm run build
npx vsce package
```

`railway-status-X.X.X.vsix` 파일이 생성됨.

## 배포 방법: 브라우저 Bearer 토큰 사용

### 1. Marketplace 토큰 획득

1. https://marketplace.visualstudio.com/manage 접속 (로그인 상태)
2. **F12** (개발자 도구) → **Network** 탭
3. 페이지 새로고침 (F5)
4. Network에서 `_apis`가 포함된 아무 요청 클릭 (예: `ClientTrace/Events`)
5. **Request Headers** → `authorization` 값 복사 (`Bearer eyJ0eXA...` 전체)

> 토큰 유효시간이 짧으므로 (약 1시간) 복사 직후 바로 사용할 것

### 2. curl로 업로드

```bash
curl -X PUT \
  "https://marketplace.visualstudio.com/_apis/gallery/publishers/taxi-tabby/extensions/railway-status?api-version=7.2-preview.2" \
  -H "Authorization: Bearer eyJ0eXA..." \
  -H "Content-Type: application/octet-stream" \
  -H "Accept: application/json;api-version=7.2-preview.2" \
  -H "X-Requested-With: Vss-Fetch" \
  -H "X-TFS-FedAuthRedirect: Suppress" \
  --data-binary @railway-status-X.X.X.vsix
```

`eyJ0eXA...` 부분을 1단계에서 복사한 토큰으로 교체.
`railway-status-X.X.X.vsix`를 실제 파일명으로 교체.

### 3. 성공 확인

- HTTP 200 응답 + JSON에 `"lastUpdated"` 날짜가 현재 시각이면 성공
- https://marketplace.visualstudio.com/items?itemName=taxi-tabby.railway-status 에서 확인 (반영까지 5~10분)

## 정상적인 배포 방법 (PAT 사용)

Azure DevOps Organization이 정상 생성 가능해지면 이 방법을 사용:

1. https://dev.azure.com → Personal Access Tokens → New Token
   - Organization: `All accessible organizations`
   - Scopes: **Marketplace > Manage**
2. `npx vsce login taxi-tabby` → 토큰 입력
3. `npx vsce publish`

## 버전 올리기

`package.json`의 `version` 필드를 수정한 후 위 과정 반복.
또는 `npx vsce publish patch` (PAT 방식에서만 가능).
