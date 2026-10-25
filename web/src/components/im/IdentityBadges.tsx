/**
 * 身份证章：只渲染服务端计算好的 prefixes。
 * 前端不解析 displayName / statusPrefix，也不拼 `[极光科技]Official`。
 */
export function IdentityBadges({
  values,
  scan = false,
  className = '',
}: {
  values: readonly string[];
  /** 只有 Header/个人页开启 6s 扫描；消息列表里最多一次性盖章，避免整屏动效 */
  scan?: boolean;
  className?: string;
}) {
  if (values.length === 0) return null;
  return (
    <span className={`identity-badges ${className}`.trim()}>
      {values.map((value) => {
        const isCustom = !value.startsWith('[');
        const isSystem = value.startsWith('[极光科技]');
        const isOfficial = value.endsWith('Official');
        const text = isCustom ? `[${value}]` : value;
        return (
          <span
            key={value}
            className={[
              'identity-badge',
              isCustom ? 'is-custom' : isSystem ? 'is-system' : 'is-org',
              isOfficial ? 'is-official' : '',
              isOfficial && scan ? 'is-scan' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-official={isOfficial ? 'true' : undefined}
            title={text}
          >
            {text}
          </span>
        );
      })}
    </span>
  );
}

/** 兼容纯文本位置（成员列表 / title 属性）：把证书拼成可读串 */
export function identityText(values: readonly string[], fallback = ''): string {
  return values.length > 0 ? values.join(' ') : fallback;
}
