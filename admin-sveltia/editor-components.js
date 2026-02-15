CMS.registerEditorComponent({
  id: 'positioned-image',
  label: 'Positioned Image',
  fields: [
    { name: 'src', label: 'Image', widget: 'image' },
    { name: 'alt', label: 'Alt Text', widget: 'string', default: '' },
    {
      name: 'position',
      label: 'Position',
      widget: 'select',
      options: [
        { label: 'Float Left', value: 'left' },
        { label: 'Float Right', value: 'right' },
        { label: 'Full Width', value: 'full' },
      ],
      default: 'left',
    },
  ],
  pattern:
    /^<img\s+(?:aria-hidden="true"\s+)?(?:class="(?<position_class>book-left|book-right)"\s+)?src="(?<src>[^"]+)"\s+alt="(?<alt>[^"]*(?:&quot;[^"]*?)*)"\s*\/?>$/m,
  fromBlock(match) {
    const posClass = match.groups.position_class || ''
    let position = 'full'
    if (posClass === 'book-left') position = 'left'
    if (posClass === 'book-right') position = 'right'
    return {
      src: match.groups.src || '',
      alt: (match.groups.alt || '').replace(/&quot;/g, '"'),
      position,
    }
  },
  toBlock(data) {
    const escAlt = (data.alt || '').replace(/"/g, '&quot;')
    const parts = ['<img aria-hidden="true"']
    if (data.position === 'left') parts.push(' class="book-left"')
    else if (data.position === 'right') parts.push(' class="book-right"')
    parts.push(` src="${data.src || ''}"`)
    parts.push(` alt="${escAlt}"`)
    parts.push('>')
    return parts.join('')
  },
  toPreview(data) {
    const escAlt = (data.alt || '').replace(/"/g, '&quot;')
    const style =
      data.position === 'left'
        ? 'float:left;width:30%;margin-right:1rem;'
        : data.position === 'right'
          ? 'float:right;width:30%;margin-left:1rem;'
          : ''
    return `<img src="${data.src || ''}" alt="${escAlt}" style="${style}">`
  },
})
