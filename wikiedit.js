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
	 * Will hold the wikitext of the current page
	 */
	pageWikitext: '',

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

		// We need to be quite specific to reduce the chances of matching paragraphs that come from templates
		$( '#mw-content-text > .mw-parser-output > p' ).each( WikiEdit.addEditButton );
	},

	/**
	 * Add edit button
	 */
	addEditButton: function () {
		var $paragraph = $( this );

		// Make the button
		var path = '<path fill="currentColor" d="M16.77 8l1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zm-5.81-3.71L1 14.25V19h4.75l9.96-9.96-4.75-4.75z"></path>';
		var icon = '<svg width="14" height="14" viewBox="0 0 20 20">' + path + '</svg>';
		var $button = $( '<span class="wikiedit-button noprint">' + icon + '</span>' );
		$button.on( 'click', WikiEdit.onEditButtonClick );

		// On mobile devices there's no hover event
		// so we just omit this part and show the button always
		if ( mw.config.get( 'skin' ) !== 'minerva' ) {
			$button.hide();
			$paragraph.on( 'mouseenter', function () { $button.show(); } );
			$paragraph.on( 'mouseleave', function () { $button.hide(); } );
		}

		// Add a little CSS here to delay loading the full CSS until the user actually clicks something
		$button.css( { 'color': '#a2a9b1', 'cursor': 'pointer' } );
		$button.on( 'mouseenter', function () { $( this ).css( 'color', '#202122' ); } );
		$button.on( 'mouseleave', function () { $( this ).css( 'color', '#a2a9b1' ); } );

		// Add to the DOM
		$paragraph.append( ' ', $button );
	},

	/**
	 * Handle clicks on edit buttons
	 */
	onEditButtonClick: function () {
		var $button = $( this ).closest( '.wikiedit-button' );
		var $paragraph = $button.parent();

		// Save the original paragraph in case we need to restore it later
		// However, for some reason the hover events on the button are not getting cloned, so we remake the button
		var $original = $paragraph.clone( true );
		$original.find( '.wikiedit-button' ).remove();
		WikiEdit.addEditButton.call( $original );

		// pageWikitext serves as a flag signaling that the dependencies were already loaded
		if ( WikiEdit.pageWikitext ) {
			WikiEdit.addEditForm( $paragraph, $original );
			return;
		}

		// If we reach this point, we need to load the dependencies
		// First, we replace the button for a loading spinner
		// to prevent further clicks and to signal the user that something's happening
		var $spinner = WikiEdit.getSpinner();
		$button.replaceWith( $spinner );

		// Note the special treatment of getTranslations()
		// because it may fail if a translation doesn't exist yet
		// and because its success callback needs to run AFTER getMessages()
		$.when(
			WikiEdit.getPageWikitext(),
			WikiEdit.getCSS(),
			WikiEdit.getMessages()
		).done( function () {
			WikiEdit.getTranslations().always( function () {
				WikiEdit.addEditForm( $paragraph, $original );
			} );
		} );
	},

	/**
	 * Add edit form
	 */
	addEditForm: function ( $paragraph, $original ) {
		// If no relevant wikitext for the element is found, fallback to regular edit
		var wikitext = WikiEdit.getParagraphWikitext( $paragraph );
		if ( !wikitext ) {
			var $section = WikiEdit.getSection( $paragraph );
			var sectionNumber = $section ? 1 + $section.prevAll( ':header' ).length : 0;
			var editUrl = mw.util.getUrl( null, { action: 'edit', section: sectionNumber } );
			window.location.href = editUrl;
			return;
		}

		// Make the form
		var $form = $( '<div class="wikiedit-form"></div>' );
		var $input = $( '<p class="wikiedit-form-input" contenteditable="true"></p>' ).text( wikitext );
		var $footer = $( '<div class="wikiedit-form-footer"></div>' );
		var summary = new OO.ui.TextInputWidget( { name: 'summary', placeholder: mw.msg( 'wikiedit-form-summary' ) } );
		var save = new OO.ui.ButtonInputWidget( { label: mw.msg( 'wikiedit-form-save' ), flags: [ 'primary', 'progressive' ] } );
		var cancel = new OO.ui.ButtonInputWidget( { label: mw.msg( 'wikiedit-form-cancel' ), framed: false, flags: 'destructive' } );
		var minorCheckbox = new OO.ui.CheckboxInputWidget( { name: 'minor' } );
		var minorLayout = new OO.ui.FieldLayout( minorCheckbox, { label: mw.msg( 'wikiedit-form-minor' ), align: 'inline' } );
		var layout = new OO.ui.HorizontalLayout( { items: [ summary, minorLayout ] } );
		$footer.append( layout.$element, save.$element, cancel.$element );
		$form.append( $input, $footer );

		// Add to the DOM
		$paragraph.html( $form );
		$input.focus();

		// Handle the cancel
		cancel.$element.on( 'click', function () {
			$paragraph.replaceWith( $original );
		} );

		// Handle the submit
		save.$element.on( 'click', function () {
			WikiEdit.onSubmit( $paragraph, $original, $form, wikitext );
		} );
	},

	/**
	 * Handle form submission
	 */
	onSubmit: function ( $paragraph, $original, $form, oldWikitext ) {
		// Use innerText because jQuery's text() removes line breaks
		var newWikitext = $form.find( '.wikiedit-form-input' ).prop( 'innerText' );

		// If no changes were made, just restore the original element
		if ( oldWikitext === newWikitext ) {
			$paragraph.replaceWith( $original );
			return;
		}

		// Get the rest of the form data
		var summary = $form.find( 'input[name="summary"]' ).val();
		var minor = $form.find( 'input[name="minor"]' ).prop( 'checked' );

		// Replace the footer with a saving message
		// to prevent further clicks and to signal the user that something's happening
		var saving = mw.msg( 'wikiedit-form-saving' );
		var $footer = $form.find( '.wikiedit-form-footer' );
		$footer.text( saving );

		// Fix excessive line breaks
		newWikitext = newWikitext.trim();
		newWikitext = newWikitext.replace( /\n\n\n+/g, '\n\n' );

		// If the paragraph was deleted, remove also any trailing newlines
		if ( !newWikitext ) {
			oldWikitext = oldWikitext.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
			oldWikitext = new RegExp( oldWikitext + '\n+' );
		}

		WikiEdit.pageWikitext = WikiEdit.pageWikitext.replace( oldWikitext, newWikitext );
		var params = {
			'action': 'edit',
			'title': mw.config.get( 'wgPageName' ),
			'text': WikiEdit.pageWikitext,
			'minor': minor,
			'summary': WikiEdit.makeSummary( summary, $form, newWikitext ),
			'tags': mw.config.get( 'wikiedit-tag' )
		};
		new mw.Api().postWithEditToken( params ).done( function () {
			WikiEdit.onSuccess( $paragraph, newWikitext );
		} );
	},

	/**
	 * Callback on successful edits
	 */
	onSuccess: function ( $paragraph, newWikitext ) {
		if ( !newWikitext ) {
			$paragraph.remove();
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
			var $html = $( text );
			$paragraph.replaceWith( $html );
			$html.filter( '.references' ).hide();
			$html.each( WikiEdit.addEditButton );
		} );
	},

	/**
	 * Get the wikitext of the current page
	 */
	getPageWikitext: function () {
		var params = {
			'page': mw.config.get( 'wgPageName' ),
			'action': 'parse',
			'prop': 'wikitext',
			'formatversion': 2,
		};
		return new mw.Api().get( params ).done( function ( data ) {
			WikiEdit.pageWikitext = data.parse.wikitext;
		} );
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
	 * Helper method to get the relevant wikitext that corresponds to a given paragraph
	 *
	 * This is actually the heart of the tool
	 * It's an heuristic method to try to find the relevant wikitext
	 * that corresponds to the paragraph being edited
	 * Since wikitext and HTML are different markups
	 * the only place where they are the same is in plain text fragments
	 * so we find the longest plain text fragments in the HTML
	 * then we search for that same fragment in the wikitext
	 * and return the entire line of wikitext containing that fragment
	 *
	 * @param {jQuery object} jQuery object representing the DOM element being edited
	 * @return {string|null} Wikitext of the paragraph being edited, or null if it can't be found
	 */
	getParagraphWikitext: function ( $paragraph ) {
		// The longest text node has the most chances of being unique
		var text = WikiEdit.getLongestText( $paragraph );

		// Some paragraphs may not have text nodes at all
		if ( !text ) {
			return;
		}

		// Match all lines that contain the text
		text = text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
		var regexp = new RegExp( '.*' + text + '.*', 'g' );
		var matches = WikiEdit.pageWikitext.match( regexp );

		// This may happen if the paragraph comes from a template
		if ( !matches ) {
			return;
		}

		// This may happen if the longest text is very short and repats somewhere else
		if ( matches.length > 1 ) {
			return;
		}

		// We got our relevant wikitext line
		return matches[0];
	},

	/**
	 * Helper method to get the text of the longest text node
	 */
	getLongestText: function ( $paragraph ) {
		var text = '';
		var $textNodes = $paragraph.contents().filter( function () {
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
	makeSummary: function ( summary, $paragraph, wikitext ) {
		if ( !summary ) {
			var action = wikitext ? 'edit' : 'delete';
			var page = mw.config.get( 'wikiedit-page', 'mw:WikiEdit' );
			summary = mw.msg( 'wikiedit-summary-' + action, page );
		}
		var $section = WikiEdit.getSection( $paragraph );
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