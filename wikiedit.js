/**
 * WikiEdit is a tool for quickly editing content without leaving the page.
 *
 * Documentation: https://www.mediawiki.org/wiki/WikiEdit
 * License: GNU General Public License 3 or later (http://www.gnu.org/licenses/gpl-3.0.html)
 * Author: Felipe Schenone (User:Sophivorus)
 */
/* global WikiEdit, mw, OO, $, atob */
window.WikiEdit = {

	/**
	 * Initialization script
	 */
	init: function () {

		// Only init when viewing
		var action = mw.config.get( 'wgAction' );
		if ( action !== 'view' ) {
			return;
		}

		// Only init in useful namespaces
		var namespaces = [ 0, 2, 4, 12, 14 ];
		var namespace = mw.config.get( 'wgNamespaceNumber' );
		var talk = namespace % 2 === 1; // Talk pages always have odd namespaces
		if ( !namespaces.includes( namespace ) && !talk ) {
			return;
		}

		// Only init in wikitext pages
		var model = mw.config.get( 'wgPageContentModel' );
		if ( model !== 'wikitext' ) {
			return;
		}

		WikiEdit.addEditButtons();
	},

	/**
	 * Add the edit buttons to the elements that are elegible for editing
	 */
	addEditButtons: function () {
		var selectors = mw.config.get( 'wikiedit-selectors', [ 'p', 'li', 'dd' ] );
		selectors = selectors.toString();
		var $elements = $( selectors, '#mw-content-text' );

		// Filter elements with no text nodes
		// @todo Make more efficient
		$elements = $elements.filter( function () {
			var $element = $( this );
			return WikiEdit.getLongestText( $element );
		} );

		$elements.each( WikiEdit.addEditButton );
	},

	/**
	 * Add edit button
	 */
	addEditButton: function () {
		var $element = $( this );

		// Make the button
		var path = '<path fill="currentColor" d="M16.77 8l1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zm-5.81-3.71L1 14.25V19h4.75l9.96-9.96-4.75-4.75z"></path>';
		var icon = '<svg width="14" height="14" viewBox="0 0 20 20">' + path + '</svg>';
		var $button = $( '<span class="wikiedit-button noprint">' + icon + '</span>' );
		$button.on( 'click', WikiEdit.onEditButtonClick );

		// On mobile devices there's no hover event so we just omit this part
		if ( mw.config.get( 'skin' ) !== 'minerva' ) {
			$button.hide();
			$element.on( 'mouseenter', function () { $button.show(); } );
			$element.on( 'mouseleave', function () { $button.hide(); } );
		}

		// Add a little CSS from here to delay loading the full CSS until the user actually clicks
		$button.css( { 'color': '#a2a9b1', 'cursor': 'pointer' } );
		$button.on( 'mouseenter', function () { $( this ).css( 'color', '#202122' ); } );
		$button.on( 'mouseleave', function () { $( this ).css( 'color', '#a2a9b1' ); } );

		// Add to the DOM
		if ( $element.children( 'ul, ol, dl' ).length ) {
			$element.children( 'ul, ol, dl' ).before( ' ', $button );
		} else {
			$element.append( ' ', $button );
		}
	},

	/**
	 * Handle click on edit button
	 */
	onEditButtonClick: function () {
		var $button = $( this ).closest( '.wikiedit-button' );
		var $element = $button.parent();

		// Replace the button for a spinner
		// to prevent further clicks and to signal the user that something's happening
		var $spinner = WikiEdit.getSpinner();
		$button.replaceWith( $spinner );

		WikiEdit.addEditForm( $element );
	},

	/**
	 * Add edit form
	 */
	addEditForm: function ( $element ) {

		// Load the page wikitext the first time this method is called
		if ( !WikiEdit.pageWikitext ) {
			WikiEdit.getPageWikitext().done( function ( data ) {
				WikiEdit.pageWikitext = data.parse.wikitext;
				WikiEdit.addEditForm( $element );
			} );
			return;
		}

		// If no relevant wikitext for the element is found, fallback to regular edit
		var wikitext = WikiEdit.getElementWikitext( $element );
		if ( !wikitext ) {
			var $section = WikiEdit.getSection( $element );
			var sectionNumber = $section ? 1 + $section.prevAll( ':header' ).length : 0;
			var editUrl = mw.util.getUrl( null, { action: 'edit', section: sectionNumber } );
			window.location.href = editUrl;
			return;
		}

		// Load the dependencies the first time we reach this point
		// Note that if any of the requests fails for whatever reason
		// we continue anyway because they are not hard dependencies
		// Also, we don't use $.when because loadMessages() needs to resolve BEFORE loadTranslations()
		if ( !WikiEdit.css ) {
			WikiEdit.getCSS().always( function () {
				WikiEdit.css = true;
				WikiEdit.addEditForm( $element );
			} );
			return;
		}
		if ( !WikiEdit.messages ) {
			WikiEdit.getMessages().always( function () {
				WikiEdit.messages = true;
				WikiEdit.addEditForm( $element );
			} );
			return;
		}
		var language = mw.config.get( 'wgPageContentLanguage' );
		if ( !WikiEdit.translations && language !== 'en' ) {
			WikiEdit.getTranslations().always( function () {
				WikiEdit.translations = true;
				WikiEdit.addEditForm( $element );
			} );
			return;
		}

		// Make the form
		var $form = $( '<div class="wikiedit-form"></div>' );
		var $input = $( '<div class="wikiedit-form-input" contenteditable="true"></div>' ).text( wikitext );
		var $footer = $( '<div class="wikiedit-form-footer"></div>' );
		var save = new OO.ui.ButtonInputWidget( { label: mw.msg( 'wikiedit-form-save' ), flags: [ 'primary', 'progressive' ] } );
		var cancel = new OO.ui.ButtonInputWidget( { label: mw.msg( 'wikiedit-form-cancel' ) } );
		var checkbox = new OO.ui.CheckboxInputWidget( { name: 'minor' } );
	    var minor = new OO.ui.FieldLayout( checkbox, { label: mw.msg( 'wikiedit-form-minor' ), align: 'inline' } );
	    var layout = new OO.ui.HorizontalLayout();
		layout.addItems( [ save, cancel, minor ] );
		$footer.append( layout.$element );
		$form.append( $input, $footer );

		// Save the original element in case we need to restore it
		var $original = $element.clone( true );
		$original.find( '.wikiedit-spinner' ).remove();
		$original.each( WikiEdit.addEditButton );

		// Add to the DOM
		$element.html( $form );
		$input.focus();
		$( 'body' ).css( 'cursor', 'auto' );

		// Handle the cancel
		cancel.$element.on( 'click', function () {
			$element.replaceWith( $original );
		} );

		// Handle the submit
		save.$element.on( 'click', {
			'element': $element,
			'original': $original,
			'wikitext': wikitext
		}, WikiEdit.onSubmit );
	},

	/**
	 * Handle form submission
	 */
	onSubmit: function ( event ) {
		var $submit = $( this );
		var $footer = $submit.closest( '.wikiedit-form-footer' );
		var $form = $submit.closest( '.wikiedit-form' );
		var minor = $footer.find( 'input[name="minor"]' ).prop( 'checked' );

		// Let the user know something is happening
		// and prevent further clicks
		var saving = mw.msg( 'wikiedit-form-saving' );
		$footer.text( saving );

		var $element = event.data.element;
		var oldWikitext = event.data.wikitext;
		var newWikitext = $form.find( '.wikiedit-form-input' ).prop( 'innerText' ); // jQuery's text() removes line breaks
		if ( oldWikitext === newWikitext ) {
			var $original = event.data.original;
			$element.replaceWith( $original );
			return;
		}

		WikiEdit.pageWikitext = WikiEdit.pageWikitext.replace( oldWikitext, newWikitext );
		var params = {
			'action': 'edit',
			'title': mw.config.get( 'wgPageName' ),
			'text': WikiEdit.pageWikitext,
			'minor': minor,
			'summary': WikiEdit.makeSummary( newWikitext, $element ),
			'tags': mw.config.get( 'wikiedit-tag' )
		};
		new mw.Api().postWithEditToken( params ).done( function () {
			WikiEdit.onSuccess( $element, newWikitext );
		} );
	},

	/**
	 * Callback on successful edits
	 */
	onSuccess: function ( $element, newWikitext ) {
		if ( !newWikitext ) {
			$element.remove();
			return;
		}
		var params = {
			'action': 'parse',
			'title': mw.config.get( 'wgPageName' ),
			'text': newWikitext,
			'formatversion': 2,
			'prop': 'text',
			'wrapoutputclass': null,
			'disablelimitreport': true,
		};
		new mw.Api().get( params ).done( function ( data ) {
			var text = data.parse.text;
			var html = $( text ).html();
			$element.html( html );
			$element.each( WikiEdit.addEditButton );
		} );
	},

	/**
	 * Load the wikitext of the current page
	 */
	getPageWikitext: function () {
		var params = {
			'page': mw.config.get( 'wgPageName' ),
			'action': 'parse',
			'prop': 'wikitext',
			'formatversion': 2,
		};
		return new mw.Api().get( params );
	},

	/**
	 * Get the CSS from the Wikimedia repository and add it to the DOM
	 */
	getCSS: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/wikiedit.css?format=text', function ( data ) {
			var css = atob( data );
			var $style = $( '<style>' ).html( css );
			$( 'head' ).append( $style );
		} );
	},

	/**
	 * Get the English messages from the Wikimedia repository
	 *
	 * English messages are always loaded as a fallback
	 * in case we don't have translated messages
	 */
	getMessages: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/i18n/en.json?format=text', function ( data ) {
			var json = WikiEdit.decodeBase64( data );
			var messages = JSON.parse( json );
			delete messages[ '@metadata' ];
			mw.messages.set( messages );
		} );
	},

	/**
	 * Get the translated messages from the Wikimedia repository
	 *
	 * We use the page language rather than the user language
	 * because the edit summaries must be in the page language
	 */
	getTranslations: function () {
		var language = mw.config.get( 'wgPageContentLanguage' );
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/i18n/' + language + '.json?format=text', function ( data ) {
			var json = WikiEdit.decodeBase64( data );
			var messages = JSON.parse( json );
			delete messages[ '@metadata' ];
			mw.messages.set( messages );
		} );
	},

	/**
	 * Helper method to get the relevant wikitext that corresponds to a given DOM element
	 *
	 * This is the heart of the tool
	 * It's an heuristic method to try to find the relevant wikitext
	 * that corresponds to the DOM element being edited
	 * Since wikitext and HTML are different markups
	 * the only place where they meet is in plain text
	 * so we find the longest fragment of plain text in the HTML
	 * and from there we figure out the boundaries of the relevant wikitext
	 *
	 * @param {jQuery object} jQuery object representing the DOM element being edited
	 * @return {string|null} Wikitext of the element being edited, or null if it can't be found
	 */
	getElementWikitext: function ( $element ) {
		var wikitext;

		// Get the text of longest text node
		// because it has the most chances of being unique
		var text = WikiEdit.getLongestText( $element );

		// Some elements don't have text nodes
		// for example list items with just a link
		if ( !text ) {
			return;
		}

		// Match all lines that contain the text
		text = text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
		var regexp = new RegExp( '.*' + text + '.*', 'g' );
		var matches = WikiEdit.pageWikitext.match( regexp );

		// This happens often when the element comes from a template
		if ( !matches ) {
			return;
		}

		// This happens often when the text is very short and accidentally repeats
		if ( matches.length > 1 ) {
			return;
		}

		// If we reach this point, we got our relevant wikitext line
		// To get to the relevant wikitext itself, we need to clean it up a little
		wikitext = matches[0];

		// Clean up list items
		wikitext = wikitext.replace( /^[*#:]+ */, '' );

		// Clean up template parameters
		wikitext = wikitext.replace( /^\|.*= */, '' );

		// Clean up table captions
		wikitext = wikitext.replace( /^\|\+ */, '' );

		// Clean up table headers
		wikitext = wikitext.replace( /^! */, '' );

		// Clean up table cells and anonymous template parameters
		wikitext = wikitext.replace( /^\| */, '' );

		// Clean up section titles
		wikitext = wikitext.replace( /^==+ *(.*?) *==+/, '$1' );

		// In theory this should not happen
		if ( !wikitext ) {
			return;
		}

		// We're done, return the relevant wikitext
		return wikitext;
	},

	/**
	 * Helper method to get the text of the longest text node
	 */
	getLongestText: function ( $element ) {
		var text = '';
		var $textNodes = $element.contents().filter( function () {
			return this.nodeType === 3; // Text node
		} );
		$textNodes.each( function () {
			var nodeText = $( this ).text().trim();
			if ( nodeText.length > text.length ) {
				text = nodeText;
			}
		} );
		return text;
	},

	/**
	 * Helper method to build a helpful edit summary
	 */
	makeSummary: function ( wikitext, $element ) {
		var action = 'edit';
		if ( !wikitext ) {
			action = 'delete';
		}
		var page = mw.config.get( 'wikiedit-page', 'mw:WikiEdit' );
		var summary = mw.msg( 'wikiedit-summary-' + action, page );
		var $section = WikiEdit.getSection( $element );
		if ( $section ) {
			var section = $section.find( '.mw-headline' ).attr( 'id' ).replaceAll( '_', ' ' );
			summary = '/* ' + section + ' */ ' + summary;
		}
		summary += ' #wikiedit'; // For https://hashtags.wmcloud.org
		return summary;
	},

	/**
	 * Helper method to find the closest section
	 * by traversing back and up the DOM tree
	 *
	 * @param {jQuery object} Starting element
	 * @return {jQuery object} Closest section
	 */
	getSection: function ( $element ) {
		if ( $element.attr( 'id' ) === 'mw-content-text' ) {
			return;
		}
		if ( $element.is( ':header' ) ) {
			return $element;
		}
		var $previous = $element.prevAll( ':header' ).first();
		if ( $previous.length ) {
			return $previous;
		}
		var $parent = $element.parent();
		return WikiEdit.getSection( $parent );
	},

	/**
	 * Helper method to get a spinner (loading) icon
	 */
	 getSpinner: function () {
		var spinner = '<svg class="wikiedit-spinner" width="14" height="14" viewBox="0 0 100 100">';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(-90 50 50)" opacity="0" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(-45 50 50)" opacity="0.125" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(0 50 50)" opacity="0.25" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(45 50 50)" opacity="0.375" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(90 50 50)" opacity="0.5" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(135 50 50)" opacity="0.625" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(180 50 50)" opacity="0.75" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" transform="rotate(225 50 50)" opacity="0.875" />';
		spinner += '</svg>';
		var $spinner = $( spinner );
		var degrees = 0;
		setInterval( function () {
			degrees += 45;
			$spinner.css( 'transform', 'rotate(' + degrees + 'deg)' );
		}, 100 );
		return $spinner;
	},

	/**
	 * Helper function to decode base64 strings
	 * See https://stackoverflow.com/questions/30106476
	 *
	 * @param {string} Encoded string
	 * @return {string} Decoded string
	 */
	decodeBase64: function ( string ) {
		return decodeURIComponent( window.atob( string ).split( '' ).map( function ( character ) {
			return '%' + ( '00' + character.charCodeAt( 0 ).toString( 16 ) ).slice( -2 );
		} ).join( '' ) );
	}
};

mw.loader.using( [
	'oojs-ui-core',
	'oojs-ui-widgets'
], WikiEdit.init );