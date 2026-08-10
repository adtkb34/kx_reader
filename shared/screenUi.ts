/**
 * ```screen fence → high-fidelity auth UI mock HTML for the reader.
 *
 * Block body is a template id (one line), e.g. `login` / `register-password`.
 * Click-to-zoom is handled client-side via `.screen-ui` (same as wireframe).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(body: string): string {
  return (
    `<div class="screen-ui" data-zoomable="screen">` +
    `<div class="su-viewport">` +
    `<div class="su-card">` +
    topBar() +
    `<div class="su-body">${body}</div>` +
    `</div></div></div>`
  );
}

/** Logged-in settings / list screens (no auth brand chrome). */
function shellApp(
  title: string,
  body: string,
  opts?: { action?: string; wide?: boolean },
): string {
  const actionHtml = opts?.action
    ? `<span class="su-app-action">${esc(opts.action)}</span>`
    : '';
  const wideClass = opts?.wide ? ' su-card-wide' : '';
  const top =
    title || opts?.action
      ? `<div class="su-app-top">` +
        (title ? `<div class="su-app-title">${esc(title)}</div>` : `<div></div>`) +
        actionHtml +
        `</div>`
      : '';
  return (
    `<div class="screen-ui" data-zoomable="screen">` +
    `<div class="su-viewport">` +
    `<div class="su-card su-card-app${wideClass}">` +
    top +
    `<div class="su-body">${body}</div>` +
    `</div></div></div>`
  );
}

/** White modal dialog (e.g. 编辑资料). */
function shellModal(title: string, body: string): string {
  return (
    `<div class="screen-ui" data-zoomable="screen">` +
    `<div class="su-viewport su-viewport-modal">` +
    `<div class="su-card su-card-modal">` +
    `<div class="su-modal-top">` +
    `<div class="su-modal-title">${esc(title)}</div>` +
    `</div>` +
    `<div class="su-body">${body}</div>` +
    `</div></div></div>`
  );
}

function topBar(): string {
  return (
    `<div class="su-top">` +
    `<div class="su-brand"><span class="su-mark">N</span><span class="su-brand-name">now-order</span></div>` +
    `<div class="su-locale">${globeIcon()}中文<span class="su-chev">▾</span></div>` +
    `</div>`
  );
}

const REGISTER_STEPS = [
  { id: 1, label: '创建账号' },
  { id: 2, label: '入口选择' },
] as const;

const FORGOT_STEPS = [
  { id: 1, label: '身份验证' },
  { id: 2, label: '更新密码' },
] as const;

type ProgressStep = { id: number; label: string };

function progressBar(
  steps: readonly ProgressStep[],
  current: number,
  opts?: { detailStepId?: number; detail?: string; aria?: string },
): string {
  const items = steps
    .map((step, index) => {
      let label = esc(step.label);
      if (opts?.detail && step.id === opts.detailStepId) {
        label = `${esc(step.label)} · <em class="su-prog-sub">${esc(opts.detail)}</em>`;
      }
      const state =
        step.id < current ? ' is-done' : step.id === current ? ' is-current' : '';
      const connector =
        index < steps.length - 1
          ? `<span class="su-prog-line${step.id < current ? ' is-on' : ''}"></span>`
          : '';
      return (
        `<div class="su-prog-step${state}">` +
        `<span class="su-prog-num">${step.id < current ? '✓' : String(step.id)}</span>` +
        `<span class="su-prog-label">${label}</span>` +
        `</div>` +
        connector
      );
    })
    .join('');
  return `<div class="su-progress" aria-label="${esc(opts?.aria ?? '进度')}">${items}</div>`;
}

/** Two-step register progress with step names inline. `current` is 1-based. */
function progress(
  current: number,
  opts?: { accountDetail?: string; entryDetail?: string },
): string {
  const detail = opts?.accountDetail ?? opts?.entryDetail;
  const detailStepId = opts?.accountDetail ? 1 : opts?.entryDetail ? 2 : undefined;
  return progressBar(REGISTER_STEPS, current, {
    detailStepId,
    detail,
    aria: '注册进度',
  });
}

/** Two-step forgot-password progress. `current` is 1-based. */
function forgotProgress(current: number, verifyDetail?: string): string {
  return progressBar(FORGOT_STEPS, current, {
    detailStepId: verifyDetail ? 1 : undefined,
    detail: verifyDetail,
    aria: '忘记密码进度',
  });
}

function entryOption(
  title: string,
  desc: string,
  iconClass: string,
): string {
  return (
    `<div class="su-entry">` +
    `<span class="su-entry-icon ${esc(iconClass)}" aria-hidden="true"></span>` +
    `<div class="su-entry-text">` +
    `<div class="su-entry-title">${esc(title)}</div>` +
    `<div class="su-entry-desc">${esc(desc)}</div>` +
    `</div>` +
    `<span class="su-entry-chev" aria-hidden="true">›</span>` +
    `</div>`
  );
}

function field(label: string, placeholder: string, filled = false): string {
  return (
    `<div class="su-field">` +
    `<div class="su-label">${esc(label)}</div>` +
    `<div class="su-input${filled ? '' : ' is-ph'}">${esc(placeholder)}</div>` +
    `</div>`
  );
}

function btnPrimary(label: string): string {
  return `<div class="su-btn su-btn-primary">${esc(label)}</div>`;
}

function btnGhost(label: string): string {
  return `<div class="su-btn su-btn-ghost">${esc(label)}</div>`;
}

/** Segmented code input (email OTP / join code). */
function otp(length: number, filled: string, ariaLabel: string): string {
  const cells = Array.from({ length }, (_, i) => {
    const ch = filled[i] ?? '';
    const on = i === filled.length ? ' is-on' : '';
    return `<span class="su-otp-cell${on}">${esc(ch)}</span>`;
  }).join('');
  const sizeClass = length > 6 ? ' su-otp-compact' : '';
  return `<div class="su-otp${sizeClass}" aria-label="${esc(ariaLabel)}">${cells}</div>`;
}

function login(): string {
  return shell(
    field('邮箱', 'you@company.com') +
      field('密码', '••••••••', true) +
      `<div class="su-forgot">忘记密码？</div>` +
      btnPrimary('登录') +
      `<div class="su-divider"><span>或</span></div>` +
      `<div class="su-social">` +
      `<div class="su-btn su-btn-ghost">${wechatIcon()}微信</div>` +
      `<div class="su-btn su-btn-ghost">${googleIcon()}Google</div>` +
      `</div>` +
      `<div class="su-foot">没有账号？ <span class="su-link">注册</span></div>`,
  );
}

function registerPassword(): string {
  return shell(
    progress(1) +
      field('邮箱', 'you@company.com') +
      field('密码', '至少6位，含字母和数字') +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('下一步')}</div>` +
      `<div class="su-foot">已有账号？ <span class="su-link">去登录</span></div>`,
  );
}

/** Same progress step as password — verify email ownership before entry. */
function registerVerify(): string {
  return shell(
    progress(1, { accountDetail: '验证邮箱' }) +
      `<p class="su-verify-mail">验证码已发送至 <span class="su-mail">you@company.com</span></p>` +
      otp(6, '48', '验证码') +
      `<div class="su-resend">没收到？ <span class="su-link">重新发送</span><span class="su-resend-wait"> · 56s</span></div>` +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('下一步')}</div>`,
  );
}

function registerEntry(): string {
  return shell(
    progress(2) +
      `<div class="su-ready">` +
      `<span class="su-ready-icon su-ico-person" aria-hidden="true"></span>` +
      `<div class="su-ready-text">` +
      `<div class="su-ready-title">已具备个人消费身份</div>` +
      `<div class="su-ready-desc">可浏览商品、发起询价；组织可随时再开。</div>` +
      `</div>` +
      `</div>` +
      btnPrimary('进入工作区') +
      `<div class="su-divider"><span>或现在开启团队</span></div>` +
      `<div class="su-entries">` +
      entryOption(
        '创建组织',
        '开设经营主体，邀请成员协作采购与履约。',
        'su-ico-org',
      ) +
      entryOption(
        '加入组织',
        '用组织码加入已有团队，承接协作席位。',
        'su-ico-join',
      ) +
      `</div>`,
  );
}

/** Same step as entry — form after choosing create org. */
function registerCreateOrg(): string {
  return shell(
    progress(2, { entryDetail: '创建组织' }) +
      `<div class="su-input is-ph">公司或团队名称</div>` +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('创建并进入')}</div>`,
  );
}

/** Same step as entry — form after choosing join org. */
function registerJoinOrg(): string {
  return shell(
    progress(2, { entryDetail: '加入组织' }) +
      otp(8, 'A3', '加入码') +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('提交申请')}</div>`,
  );
}

function registerSocial(): string {
  return shell(
    progress(1, { accountDetail: '基本信息' }) +
      `<div class="su-badge">${wechatIcon()}已通过微信授权</div>` +
      field('邮箱', 'you@company.com') +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('下一步')}</div>`,
  );
}

function forgotVerify(): string {
  return shell(
    forgotProgress(1) +
      field('邮箱', 'you@company.com') +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('下一步')}</div>` +
      `<div class="su-foot"><span class="su-link">返回登录</span></div>`,
  );
}

function forgotCode(): string {
  return shell(
    forgotProgress(1, '验证邮箱') +
      `<p class="su-verify-mail">验证码已发送至 <span class="su-mail">you@company.com</span></p>` +
      otp(6, '48', '验证码') +
      `<div class="su-resend">没收到？ <span class="su-link">重新发送</span><span class="su-resend-wait"> · 56s</span></div>` +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('下一步')}</div>`,
  );
}

function forgotReset(): string {
  return shell(
    forgotProgress(2) +
      field('新密码', '至少6位，含字母和数字') +
      field('确认密码', '再次输入新密码') +
      `<div class="su-actions">${btnGhost('返回')}${btnPrimary('完成')}</div>`,
  );
}

function editIcon(): string {
  return (
    `<span class="su-icon-btn" aria-label="编辑" title="编辑">` +
    `<svg class="su-icon-edit" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">` +
    `<path fill="currentColor" d="M4 17.3V20h2.7l10-10-2.7-2.7-10 10Zm15.1-9.4c.4-.4.4-1 0-1.4l-2.6-2.6a1 1 0 0 0-1.4 0l-1.5 1.5 4 4 1.5-1.5Z"/>` +
    `</svg></span>`
  );
}

/** Lucide-style globe — clearer than the CSS circle glyph. */
function globeIcon(): string {
  return (
    `<svg class="su-globe" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="12" cy="12" r="9"/>` +
    `<path d="M3.6 9h16.8M3.6 15h16.8"/>` +
    `<path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>` +
    `</svg>`
  );
}

function wechatIcon(): string {
  return (
    `<svg class="su-brand-icon su-brand-wx" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">` +
    `<path fill="currentColor" d="M9.5 4C5.9 4 3 6.5 3 9.6c0 1.8 1 3.3 2.6 4.4l-.6 2.2 2.4-1.2c.7.2 1.4.3 2.1.3.2 0 .5 0 .7-.1-.2-.5-.3-1.1-.3-1.6 0-3.1 2.9-5.6 6.4-5.6.2 0 .5 0 .7.1C16.5 5.7 13.3 4 9.5 4Zm-2.2 3.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.2 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8ZM16.6 9.8c-2.9 0-5.3 2-5.3 4.5s2.4 4.5 5.3 4.5c.5 0 1.1-.1 1.6-.2l1.9.9-.5-1.7c1.2-.9 2-2.1 2-3.5 0-2.5-2.4-4.5-5-4.5Zm-1.7 3.2a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4Zm3.4 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4Z"/>` +
    `</svg>`
  );
}

function googleIcon(): string {
  return (
    `<svg class="su-brand-icon su-brand-gg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">` +
    `<path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.4-1 2.5-2.1 3.3v2.7h3.4c2-1.8 3.4-4.5 3.4-8Z"/>` +
    `<path fill="#34A853" d="M12 23c2.8 0 5.2-.9 6.9-2.5l-3.4-2.7c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.8C4.4 20.5 7.9 23 12 23Z"/>` +
    `<path fill="#FBBC05" d="M6.2 14.5c-.2-.6-.4-1.3-.4-2s.1-1.4.4-2V7.7H2.7C2 9.1 1.6 10.5 1.6 12s.4 2.9 1.1 4.3l3.5-2.8Z"/>` +
    `<path fill="#EA4335" d="M12 5.4c1.5 0 2.9.5 4 1.6l3-3C17.2 2.2 14.8 1.2 12 1.2 7.9 1.2 4.4 3.7 2.7 7.7l3.5 2.8c.8-2.5 3.1-4.3 5.8-4.3Z"/>` +
    `</svg>`
  );
}

function orgMoreMenu(isOwner = true): string {
  return (
    `<div class="su-more">` +
    `<span class="su-more-btn" aria-label="更多">···</span>` +
    `<div class="su-more-menu">` +
    `<div class="su-more-item">切换</div>` +
    (isOwner ? `<div class="su-more-item">编辑</div>` : '') +
    `<div class="su-more-item">创建</div>` +
    `<div class="su-more-item">离开</div>` +
    `</div></div>`
  );
}

function layoutLabel(text: string): string {
  return `<div class="su-layout-label">${esc(text)}</div>`;
}

/** Shared personal-info card for mobile & PC. */
function profileIdentityCard(layoutOnly = false): string {
  const body = layoutOnly
    ? layoutLabel('个人信息')
    : editIcon() +
      `<div class="su-hero">` +
      `<div class="su-avatar" aria-hidden="true">ZW</div>` +
      `<div class="su-hero-text">` +
      `<div class="su-hero-name">张伟</div>` +
      `</div></div>` +
      `<div class="su-pc-facts">` +
      `<div class="su-pc-fact"><span class="su-kv-k">手机</span><span class="su-kv-v">+86 138 0000 8000</span></div>` +
      `<div class="su-pc-fact"><span class="su-kv-k">邮箱</span><span class="su-kv-v">you@company.com</span></div>` +
      `</div>`;
  return (
    `<div class="su-panel su-panel-identity${layoutOnly ? ' su-panel-layout' : ''}">` +
    body +
    `</div>`
  );
}

/** Current-org card on profile — PC/mobile 均只留布局骨架；明细见组织信息。 */
function profileOrgCard(layoutOnly = false): string {
  const body = layoutOnly
    ? layoutLabel('组织信息')
    : `<div class="su-hero">` +
      `<div class="su-avatar su-avatar-org" aria-hidden="true">华</div>` +
      `<div class="su-hero-text">` +
      `<div class="su-hero-name">华东供应链</div>` +
      `</div></div>` +
      `<div class="su-pc-facts">` +
      `<div class="su-pc-fact"><span class="su-kv-k">加入码</span><span class="su-kv-v">A3F9K2M8</span></div>` +
      `<div class="su-pc-fact"><span class="su-kv-k">角色</span><span class="su-kv-v">负责人</span></div>` +
      `</div>`;
  const head = layoutOnly ? '' : `<div class="su-panel-head">${orgMoreMenu()}</div>`;
  return (
    `<div class="su-panel su-panel-org${layoutOnly ? ' su-panel-layout' : ''}">` +
    head +
    body +
    `</div>`
  );
}

/** 组织信息明细（组织管理）。 */
function orgInfoBody(): string {
  return (
    `<div class="su-panel su-panel-org">` +
    `<div class="su-panel-head">` +
    `<div class="su-panel-title">组织信息</div>` +
    orgMoreMenu() +
    `</div>` +
    `<div class="su-hero">` +
    `<div class="su-avatar su-avatar-org" aria-hidden="true">华</div>` +
    `<div class="su-hero-text">` +
    `<div class="su-hero-name">华东供应链</div>` +
    `</div></div>` +
    `<div class="su-pc-facts">` +
    `<div class="su-pc-fact"><span class="su-kv-k">加入码</span><span class="su-kv-v">A3F9K2M8</span></div>` +
    `<div class="su-pc-fact"><span class="su-kv-k">角色</span><span class="su-kv-v">负责人</span></div>` +
    `</div></div>`
  );
}

function orgInfo(): string {
  return shellApp('', orgInfoBody());
}

function profile(): string {
  return shellApp(
    '',
    profileIdentityCard() +
      profileOrgCard(true) +
      `<div class="su-menu">` +
      `<div class="su-menu-row"><span>组织申请</span><span class="su-menu-trail"><span class="su-count">1</span><span class="su-menu-chev" aria-hidden="true"></span></span></div>` +
      `<div class="su-menu-row"><span>加入审批</span><span class="su-menu-trail"><span class="su-count">2</span><span class="su-menu-chev" aria-hidden="true"></span></span></div>` +
      `<div class="su-menu-row"><span>成员清单</span><span class="su-menu-trail"><span class="su-menu-num">3</span><span class="su-menu-chev" aria-hidden="true"></span></span></div>` +
      `</div>` +
      `<div class="su-btn su-btn-danger">退出登录</div>`,
  );
}

function profilePc(): string {
  return shellApp(
    '',
    `<div class="su-pc-grid">` +
      profileIdentityCard(true) +
      profileOrgCard(true) +
      `</div>` +
      `<div class="su-menu">` +
      `<div class="su-menu-row su-menu-row-shell">${layoutLabel('组织申请')}</div>` +
      `<div class="su-menu-row su-menu-row-shell">${layoutLabel('加入审批')}</div>` +
      `<div class="su-menu-row su-menu-row-shell">${layoutLabel('成员清单')}</div>` +
      `</div>` +
      `<div class="su-pc-foot">` +
      `<div class="su-btn su-btn-danger su-btn-inline">退出登录</div>` +
      `</div>`,
    { wide: true },
  );
}

function cameraIcon(): string {
  return (
    `<svg class="su-icon-camera" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M4 8h3l2-2h6l2 2h3v11H4V8Z"/>` +
    `<circle cx="12" cy="13" r="3.5"/>` +
    `</svg>`
  );
}

function profileEdit(): string {
  return shellModal(
    '编辑资料',
    `<div class="su-avatar-edit">` +
      `<div class="su-avatar su-avatar-lg" aria-hidden="true">ZW</div>` +
      `<span class="su-avatar-edit-btn" aria-label="更换头像" title="更换头像">${cameraIcon()}</span>` +
      `</div>` +
      `<div class="su-row">` +
      field('姓', '张', true) +
      field('名', '伟', true) +
      `</div>` +
      `<div class="su-row">` +
      `<div class="su-field"><div class="su-label">地区</div>` +
      `<div class="su-input su-select"><span>中国 +86</span><span class="su-chev">▾</span></div></div>` +
      field('手机', '138 0000 8000', true) +
      `</div>` +
      `<div class="su-kv su-kv-muted"><span class="su-kv-k">邮箱</span><span class="su-kv-v">you@company.com（不可改）</span></div>` +
      `<div class="su-actions">${btnGhost('取消')}${btnPrimary('保存')}</div>`,
  );
}

/** 编辑组织（负责人）：白底弹窗，对齐编辑资料。 */
function orgEdit(): string {
  return shellModal(
    '编辑组织',
    `<div class="su-avatar-edit">` +
      `<div class="su-avatar su-avatar-lg su-avatar-org" aria-hidden="true">华</div>` +
      `<span class="su-avatar-edit-btn" aria-label="更换头像" title="更换头像">${cameraIcon()}</span>` +
      `</div>` +
      field('组织名称', '华东供应链', true) +
      `<div class="su-kv su-kv-muted"><span class="su-kv-k">加入码</span><span class="su-kv-v">A3F9K2M8（不可改）</span></div>` +
      `<div class="su-actions">${btnGhost('取消')}${btnPrimary('保存')}</div>`,
  );
}

function statusPill(label: string, kind: 'pending' | 'rejected' | 'approved'): string {
  return `<span class="su-status su-status-${kind}">${esc(label)}</span>`;
}

function orgApplications(): string {
  return shellApp(
    '组织申请',
    `<div class="su-applist">` +
      `<div class="su-app-item">` +
      `<div class="su-app-item-main">` +
      `<div class="su-app-item-title">华南海鲜</div>` +
      `<div class="su-app-item-meta">申请于 2026-08-02</div>` +
      `</div>` +
      statusPill('待审核', 'pending') +
      `<div class="su-app-item-action su-link">撤回</div>` +
      `</div>` +
      `<div class="su-app-item">` +
      `<div class="su-app-item-main">` +
      `<div class="su-app-item-title">北方冷链</div>` +
      `<div class="su-app-item-meta">申请于 2026-07-18</div>` +
      `</div>` +
      statusPill('已拒绝', 'rejected') +
      `</div>` +
      `<div class="su-app-item">` +
      `<div class="su-app-item-main">` +
      `<div class="su-app-item-title">华东供应链</div>` +
      `<div class="su-app-item-meta">申请于 2026-06-01</div>` +
      `</div>` +
      statusPill('已通过', 'approved') +
      `</div>` +
      `</div>` +
      btnPrimary('申请加入组织'),
  );
}

/** PC：宽版布局骨架，保留主按钮；列表明细见移动端。 */
function orgApplicationsPc(): string {
  return shellApp(
    '组织申请',
    `<div class="su-applist su-applist-ghost">` +
      `<div class="su-app-item su-app-item-ghost"></div>` +
      `<div class="su-app-item su-app-item-ghost"></div>` +
      `<div class="su-app-item su-app-item-ghost"></div>` +
      `</div>` +
      `<div class="su-pc-foot">` +
      `<div class="su-btn su-btn-primary su-btn-inline">申请加入组织</div>` +
      `</div>`,
    { wide: true },
  );
}

/** 加入审批 — 仅负责人 / 管理员可见（示意）。 */
function approveCard(opts: {
  initial: string;
  name: string;
  meta: string;
  role?: string;
  status?: 'pending' | 'approved' | 'rejected';
}): string {
  const status = opts.status ?? 'pending';
  const head =
    `<div class="su-approve-person">` +
    `<div class="su-avatar" aria-hidden="true">${esc(opts.initial)}</div>` +
    `<div class="su-approve-person-text">` +
    `<div class="su-approve-name">${esc(opts.name)}</div>` +
    `<div class="su-approve-meta">${esc(opts.meta)}</div>` +
    `</div></div>`;
  if (status === 'pending') {
    const role = opts.role ?? '成员';
    return (
      `<div class="su-approve-card">` +
      head +
      `<div class="su-approve-foot">` +
      `<div class="su-approve-role">` +
      `<span class="su-approve-label">通过为</span>` +
      `<div class="su-input su-select su-select-sm"><span>${esc(role)}</span><span class="su-chev">▾</span></div>` +
      `</div>` +
      `<div class="su-approve-actions">` +
      `<div class="su-btn su-btn-danger su-btn-sm">拒绝</div>` +
      `<div class="su-btn su-btn-primary su-btn-sm">通过</div>` +
      `</div>` +
      `</div></div>`
    );
  }
  if (status === 'approved') {
    const role = opts.role ?? '成员';
    return (
      `<div class="su-approve-card">` +
      head +
      `<div class="su-approve-foot">` +
      `<div class="su-approve-role">` +
      `<span class="su-approve-label">赋予角色</span>` +
      `<span class="su-approve-role-val">${esc(role)}</span>` +
      `</div>` +
      `</div></div>`
    );
  }
  // rejected — 可重新选择角色后通过
  const role = opts.role ?? '成员';
  return (
    `<div class="su-approve-card">` +
    head +
    `<div class="su-approve-foot">` +
    `<div class="su-approve-role">` +
    `<span class="su-approve-label">通过为</span>` +
    `<div class="su-input su-select su-select-sm"><span>${esc(role)}</span><span class="su-chev">▾</span></div>` +
    `</div>` +
    `<div class="su-approve-actions">` +
    `<div class="su-btn su-btn-primary su-btn-sm">通过</div>` +
    `</div>` +
    `</div></div>`
  );
}

function approveAccordion(
  label: string,
  count: number,
  open: boolean,
  body: string,
  kind: 'pending' | 'approved' | 'rejected',
): string {
  const openAttr = open ? ' open' : '';
  return (
    `<details class="su-accord su-accord-${kind}"${openAttr}>` +
    `<summary class="su-accord-sum">` +
    `<span class="su-accord-title">${esc(label)}</span>` +
    `<span class="su-accord-count">${count}</span>` +
    `<span class="su-accord-chev" aria-hidden="true"></span>` +
    `</summary>` +
    `<div class="su-accord-body">` +
    body +
    `<div class="su-paging">` +
    `<span class="su-paging-btn su-paging-btn-disabled">上一页</span>` +
    `<span class="su-paging-pages">` +
    `<span class="su-paging-num su-paging-num-on">1</span>` +
    `<span class="su-paging-num">2</span>` +
    `</span>` +
    `<span class="su-paging-btn">下一页</span>` +
    `</div>` +
    `</div></details>`
  );
}

function joinApproval(): string {
  return shellApp(
    '加入审批',
    `<div class="su-accord-list">` +
      approveAccordion(
        '待审',
        1,
        true,
        `<div class="su-approve-list">` +
          approveCard({
            initial: '李',
            name: '李明',
            meta: 'li.ming@example.com · 2026-08-08',
            role: '成员',
            status: 'pending',
          }) +
          `</div>`,
        'pending',
      ) +
      approveAccordion(
        '已通过',
        1,
        false,
        `<div class="su-approve-list">` +
          approveCard({
            initial: '王',
            name: '王芳',
            meta: 'wang.fang@example.com · 2026-08-07',
            role: '管理员',
            status: 'approved',
          }) +
          `</div>`,
        'approved',
      ) +
      approveAccordion(
        '已拒绝',
        1,
        false,
        `<div class="su-approve-list">` +
          approveCard({
            initial: '陈',
            name: '陈强',
            meta: 'chen.qiang@example.com · 2026-08-01',
            role: '成员',
            status: 'rejected',
          }) +
          `</div>`,
        'rejected',
      ) +
      `</div>`,
  );
}

function approveCardGhost(withFoot: boolean): string {
  const foot = withFoot
    ? `<div class="su-approve-foot su-approve-foot-ghost">` +
      `<div class="su-ghost-bar su-ghost-bar-role"></div>` +
      `<div class="su-ghost-bar su-ghost-bar-btns"></div>` +
      `</div>`
    : '';
  return (
    `<div class="su-approve-card su-approve-card-layout" aria-hidden="true">` +
    `<div class="su-approve-person">` +
    `<div class="su-avatar su-avatar-ghost"></div>` +
    `<div class="su-approve-person-text">` +
    `<div class="su-ghost-bar su-ghost-bar-title"></div>` +
    `<div class="su-ghost-bar su-ghost-bar-meta"></div>` +
    `</div></div>` +
    foot +
    `</div>`
  );
}

/** PC：Tab 分状态；内容仅布局骨架（明细见移动端）。 */
function joinApprovalPc(): string {
  return shellApp(
    '加入审批',
    `<div class="su-tabs">` +
      `<div class="su-tab su-tab-pending su-tab-on">待审</div>` +
      `<div class="su-tab su-tab-approved">已通过</div>` +
      `<div class="su-tab su-tab-rejected">已拒绝</div>` +
      `</div>` +
      `<div class="su-approve-list su-approve-list-pc">` +
      approveCardGhost(true) +
      approveCardGhost(true) +
      `</div>` +
      `<div class="su-paging su-paging-ghost" aria-hidden="true">` +
      `<div class="su-ghost-bar su-ghost-bar-page"></div>` +
      `<div class="su-ghost-bar su-ghost-bar-pages"></div>` +
      `<div class="su-ghost-bar su-ghost-bar-page"></div>` +
      `</div>`,
    { wide: true },
  );
}

function memberRow(opts: {
  initial: string;
  name: string;
  meta: string;
  role: string;
}): string {
  return (
    `<div class="su-member-row">` +
    `<div class="su-member-top">` +
    `<div class="su-avatar" aria-hidden="true">${esc(opts.initial)}</div>` +
    `<div class="su-member-main">` +
    `<div class="su-member-name">${esc(opts.name)}</div>` +
    `<div class="su-member-meta">${esc(opts.meta)}</div>` +
    `</div></div>` +
    `<div class="su-member-foot">` +
    `<div class="su-member-role">` +
    `<span class="su-member-role-label">角色</span>` +
    `<div class="su-input su-select su-select-sm"><span>${esc(opts.role)}</span><span class="su-chev">▾</span></div>` +
    `</div>` +
    `<div class="su-btn su-btn-danger su-btn-sm">移除</div>` +
    `</div></div>`
  );
}

function memberAccordion(
  label: string,
  count: number,
  open: boolean,
  body: string,
  kind: 'owner' | 'admin' | 'member',
  opts?: { paging?: boolean },
): string {
  const openAttr = open ? ' open' : '';
  const paging =
    opts?.paging === false
      ? ''
      : `<div class="su-paging">` +
        `<span class="su-paging-btn su-paging-btn-disabled">上一页</span>` +
        `<span class="su-paging-pages">` +
        `<span class="su-paging-num su-paging-num-on">1</span>` +
        `<span class="su-paging-num">2</span>` +
        `</span>` +
        `<span class="su-paging-btn">下一页</span>` +
        `</div>`;
  return (
    `<details class="su-accord su-accord-${kind}"${openAttr}>` +
    `<summary class="su-accord-sum">` +
    `<span class="su-accord-title">${esc(label)}</span>` +
    `<span class="su-accord-count">${count}</span>` +
    `<span class="su-accord-chev" aria-hidden="true"></span>` +
    `</summary>` +
    `<div class="su-accord-body">` +
    body +
    paging +
    `</div></details>`
  );
}

/** 成员清单 — 按预设角色分风琴；行内可改角色。 */
function memberList(): string {
  return shellApp(
    '成员清单',
    `<div class="su-accord-list">` +
      memberAccordion(
        '负责人',
        1,
        true,
        `<div class="su-member-list">` +
          memberRow({
            initial: '张',
            name: '张伟',
            meta: 'you@company.com',
            role: '负责人',
          }) +
          `</div>`,
        'owner',
        { paging: false },
      ) +
      memberAccordion(
        '管理员',
        1,
        false,
        `<div class="su-member-list">` +
          memberRow({
            initial: '王',
            name: '王芳',
            meta: 'wang.fang@example.com',
            role: '管理员',
          }) +
          `</div>`,
        'admin',
      ) +
      memberAccordion(
        '成员',
        1,
        false,
        `<div class="su-member-list">` +
          memberRow({
            initial: '李',
            name: '李明',
            meta: 'li.ming@example.com',
            role: '成员',
          }) +
          `</div>`,
        'member',
      ) +
      `</div>`,
  );
}

/** PC：Tab 分角色；内容仅布局骨架（明细见移动端）。负责人无分页。 */
function memberListPc(): string {
  return shellApp(
    '成员清单',
    `<div class="su-tabs">` +
      `<div class="su-tab su-tab-owner su-tab-on">负责人</div>` +
      `<div class="su-tab su-tab-admin">管理员</div>` +
      `<div class="su-tab su-tab-member">成员</div>` +
      `</div>` +
      `<div class="su-member-list su-member-list-pc">` +
      `<div class="su-member-row su-member-row-ghost" aria-hidden="true">` +
      `<div class="su-ghost-bar su-ghost-bar-member"></div>` +
      `<div class="su-member-foot su-member-foot-ghost">` +
      `<div class="su-ghost-bar su-ghost-bar-role"></div>` +
      `<div class="su-ghost-bar su-ghost-bar-remove"></div>` +
      `</div></div>` +
      `</div>`,
    { wide: true },
  );
}

/** 切换角色确认。 */
function memberRoleConfirm(): string {
  return shellModal(
    '确认变更角色',
    `<div class="su-confirm-text">将 <strong>王芳</strong> 的角色从「管理员」变更为「成员」？</div>` +
      `<div class="su-actions">${btnGhost('取消')}${btnPrimary('确认变更')}</div>`,
  );
}

/** 赋予负责人：操作者（当前负责人）将降为管理员。 */
function memberRoleOwnerConfirm(): string {
  return shellModal(
    '确认移交负责人',
    `<div class="su-confirm-text">将 <strong>王芳</strong> 设为负责人后，你将自动降级为管理员。</div>` +
      `<div class="su-actions">${btnGhost('取消')}${btnPrimary('确认移交')}</div>`,
  );
}

/** 移除成员确认。 */
function memberRemoveConfirm(): string {
  return shellModal(
    '确认移除',
    `<div class="su-confirm-text">将 <strong>李明</strong> 移出本组织？移除后其将失去本组织访问权限。</div>` +
      `<div class="su-actions">${btnGhost('取消')}<div class="su-btn su-btn-danger">确认移除</div></div>`,
  );
}

/** 移除自身确认（非负责人）。 */
function memberRemoveSelfConfirm(): string {
  return shellModal(
    '确认离开组织',
    `<div class="su-confirm-text">将自己移出本组织？离开后你将失去本组织访问权限。</div>` +
      `<div class="su-actions">${btnGhost('取消')}<div class="su-btn su-btn-danger">确认离开</div></div>`,
  );
}

/** 负责人移除自身：须先移交或解散。 */
function memberRemoveOwnerBlock(): string {
  return shellModal(
    '无法直接移除',
    `<div class="su-confirm-text">负责人移除自身前，须完成负责人移交或解散组织。</div>` +
      `<div class="su-actions-stack">` +
      `${btnPrimary('移交负责人')}` +
      `<div class="su-btn su-btn-danger">解散组织</div>` +
      `${btnGhost('取消')}` +
      `</div>`,
  );
}

const TEMPLATES: Record<string, () => string> = {
  login,
  'register-password': registerPassword,
  'register-verify': registerVerify,
  'register-entry': registerEntry,
  'register-create-org': registerCreateOrg,
  'register-join-org': registerJoinOrg,
  'register-social': registerSocial,
  'forgot-verify': forgotVerify,
  'forgot-code': forgotCode,
  'forgot-reset': forgotReset,
  profile,
  'profile-pc': profilePc,
  'profile-edit': profileEdit,
  'org-info': orgInfo,
  'org-edit': orgEdit,
  'org-applications': orgApplications,
  'org-applications-pc': orgApplicationsPc,
  'join-approval': joinApproval,
  'join-approval-pc': joinApprovalPc,
  'member-list': memberList,
  'member-list-pc': memberListPc,
  'member-role-confirm': memberRoleConfirm,
  'member-role-owner-confirm': memberRoleOwnerConfirm,
  'member-remove-confirm': memberRemoveConfirm,
  'member-remove-self-confirm': memberRemoveSelfConfirm,
  'member-remove-owner-block': memberRemoveOwnerBlock,
};

export function renderScreenUi(source: string): string {
  const id = source.replace(/\r\n/g, '\n').trim().split('\n')[0]?.trim() ?? '';
  const render = TEMPLATES[id];
  if (!render) {
    return (
      `<pre class="screen-ui screen-ui-error">` +
      `<span>未知的 screen 模板：${esc(id || '（空）')}。可用：${Object.keys(TEMPLATES).join('、')}</span>` +
      `</pre>`
    );
  }
  return render();
}
