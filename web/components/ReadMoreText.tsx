type Props = { text: string; className?: string };

const READ_MORE_THRESHOLD = 100;

export default function ReadMoreText({ text, className = '' }: Props) {
  const content = text.trim();
  if (!content) return null;

  if (content.length <= READ_MORE_THRESHOLD) {
    return <p dir="auto" className={className}>{content}</p>;
  }

  return (
    <details dir="auto" className={"storefront-read-more group " + className}>
      <summary>
        <span className="storefront-read-more-preview line-clamp-3 group-open:hidden">{content}</span>
        <span className="storefront-read-more-more group-open:hidden">קרא עוד</span>
        <span className="storefront-read-more-less hidden group-open:inline-block">קרא פחות</span>
      </summary>
      <p className="storefront-read-more-expanded mt-2">{content}</p>
    </details>
  );
}
