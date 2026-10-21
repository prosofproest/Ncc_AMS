export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header row between wrap mb">
      <div>
        <h1 className="page-header-title">{title}</h1>
        {description && <div className="page-header-desc">{description}</div>}
      </div>
      {actions && <div className="row gap-s wrap">{actions}</div>}
    </div>
  );
}

export default PageHeader;
